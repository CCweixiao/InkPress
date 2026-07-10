import { NextRequest, NextResponse } from "next/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  readContentAt,
  readTechnicalDocumentContent,
} from "@/lib/content-store";
import { getAgentConfig } from "@/lib/ai/agent-config";
import {
  runClaudeAgentRuntime,
  readUsageFromError,
  readSessionFromError,
  readRuntimeMetadataFromError,
  readMirrorHealthyFromError,
} from "@/lib/ai/claude-agent-runtime";
import { createRunAbortSignal } from "@/lib/ai/run-timeout";
import { chooseLlmConfig } from "@/lib/ai/llm-config";
import { upsertUsageTurnIfSessionGenerationCurrent } from "@/lib/ai/usage-ledger";
import { getArticleProfile } from "@/lib/ai/article-type-profile";
import { createAgentEventWriter } from "@/lib/ai/agent-event-writer";
import {
  findAgentSession,
  getOrCreateAgentSession,
  loadAgentMessages,
  mergeAndPersistMessagesIfGenerationCurrent,
  captureSessionGeneration,
  type AgentTarget,
} from "@/lib/ai/chat-persistence";
import {
  acquireTurnLease,
  releaseTurnLease,
} from "@/lib/ai/chat-turn-lease";
import { replaceLastUserText } from "@/lib/ai/message-overrides";
import { abortApproval } from "@/lib/ai/pending-approvals";
import { classifyError } from "@/lib/ai/error-classify";
import {
  CAPABILITY_REPLY,
  CLARIFY_REPLY,
  isAccidentalInput,
  isCapabilityQuestion,
} from "@/lib/ai/capability-reply";
import {
  EMPTY_ARTICLE_REPLY,
  referencesCurrentArticle,
} from "@/lib/ai/current-article";
import { estimateTokens } from "@/lib/ai/context-manager";
import {
  codeSourceProject,
  createOrReuseCodeSourceGrant,
  extractCodeSourceCandidate,
  type CodeSourceReference,
} from "@/lib/ai/code-source";
import { moduleLogger } from "@/lib/logger";
import { withApiLog } from "@/lib/api-log";
import { requireLicenseForApi } from "@/lib/license/guard";

const log = moduleLogger("ai.chat");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const targetSchema = z.object({
  kind: z.enum(["article", "technical-document"]),
  id: z.string().min(1),
});

const postSchema = z
  .object({
    target: targetSchema.optional(),
    articleId: z.string().min(1).optional(),
    providerId: z.string().optional().nullable(),
    modelId: z.string().optional().nullable(),
    messages: z.array(z.unknown()).min(1),
    // 斜杠命令 /<skill> 强制建议 Claude Agent 优先加载的 Skill（最多 4 个）。
    forceSkillIds: z.array(z.string().min(1)).max(4).optional(),
    // 实时编辑区正文：权威来源，覆盖 DB 读取，避免 flush 时序导致 Agent 拿到空/旧正文。
    currentMarkdown: z.string().nullable().optional(),
    // UI 保持用户可读文本；Agent runtime 可使用带内部 marker 的覆盖文本。
    messageOverride: z.string().optional(),
    // 编辑历史消息：从选中的 assistant checkpoint fork；首条消息重试则强制新会话。
    resumeSessionAt: z.string().min(1).optional(),
    restartSession: z.boolean().optional(),
  })
  .refine((value) => value.target || value.articleId, {
    message: "缺少对话目标",
  });

type LoadedTarget = {
  target: AgentTarget;
  title: string;
  markdown: string;
  digest?: string;
  documentType?: string;
  snapshotHash?: string;
  profileId?: string | null;
  contentRevision?: number;
};

function normalizeTarget(input: {
  target?: z.infer<typeof targetSchema>;
  articleId?: string;
}): AgentTarget {
  return input.target ?? { kind: "article", id: input.articleId! };
}

async function loadTarget(target: AgentTarget): Promise<LoadedTarget | null> {
  if (target.kind === "article") {
    const article = await prisma.article.findUnique({ where: { id: target.id } });
    if (!article) return null;
    return {
      target,
      title: article.title,
      markdown: article.contentPath
        ? await readContentAt(article.contentPath)
        : article.contentMd,
      digest: article.digest ?? "",
      profileId: article.profileId,
      contentRevision: article.contentRevision,
    };
  }
  const document = await prisma.technicalDocument.findUnique({
    where: { id: target.id },
  });
  if (!document) return null;
  return {
    target,
    title: document.title,
    markdown: document.contentPath
      ? await readTechnicalDocumentContent(document.id)
      : "",
    documentType: document.documentType,
    snapshotHash: document.snapshotHash,
  };
}

function targetFromQuery(req: NextRequest): AgentTarget | null {
  const targetKind = req.nextUrl.searchParams.get("targetKind");
  const targetId = req.nextUrl.searchParams.get("targetId");
  if (targetKind && targetId && targetSchema.safeParse({ kind: targetKind, id: targetId }).success) {
    return { kind: targetKind as AgentTarget["kind"], id: targetId };
  }
  const articleId = req.nextUrl.searchParams.get("articleId");
  return articleId ? { kind: "article", id: articleId } : null;
}

function lastUserText(messages: UIMessage[]) {
  const message = [...messages].reverse().find((item) => item.role === "user");
  return (message?.parts ?? [])
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

/** 用户取消 / 断连触发的中止：不是真正的错误，单独识别以免当作异常展示或记错误日志。 */
function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function errorMessage(error: unknown) {
  // 中止（用户取消/断连）：返回中性文案。此时客户端通常已断开，不会展示；仅用于流内收尾。
  if (isAbortError(error)) return "对话已取消。";
  // 统一委托 classifyError（前后端共享同一份归类规则，含厂商中文限流文案与 statusCode 探测）。
  // 注意：streamText 的 onError 返回值会被忽略；真正面向用户的归类展示由前端
  // AgentErrorBlock 对 useChat 转发的 error 调用同一份 classifyError 完成。
  return classifyError(error).label;
}

function writeStep(
  writer: { write: (part: never) => void },
  input: {
    id: string;
    kind: string;
    title: string;
    detail?: string;
    status?: "running" | "completed" | "failed";
  }
) {
  writer.write({
    type: "data-agent-step",
    id: input.id,
    data: { ...input, status: input.status ?? "completed" },
  } as never);
}

function looksLikeGitHistoryRequest(text: string): boolean {
  return /git\s*(?:diff|log)|commit|提交(?:记录|历史)?|版本区间|更新日志|变更记录|release\s*note|pr\b|pull\s*request|v?\d+(?:\.\d+)+\s*(?:到|至|~|～|→|\.\.)\s*v?\d+(?:\.\d+)+/i.test(
    text
  );
}

function estimateUiMessagesTokens(messages: UIMessage[]): number {
  return messages.reduce((total, message) => {
    const text = (message.parts ?? [])
      .map((part) => {
        const p = part as Record<string, unknown>;
        if (p.type === "text" && typeof p.text === "string") return p.text;
        if (
          (typeof p.type === "string" && p.type.startsWith("tool-")) ||
          p.type === "dynamic-tool"
        ) {
          return ["input", "output"]
            .map((key) => {
              const value = p[key];
              if (typeof value === "string") return value;
              if (value && typeof value === "object") {
                try {
                  return JSON.stringify(value);
                } catch {
                  return "";
                }
              }
              return "";
            })
            .join("\n");
        }
        return "";
      })
      .join("\n");
    return total + estimateTokens(text);
  }, 0);
}

export async function GET(req: NextRequest) {
  const target = targetFromQuery(req);
  if (!target) {
    return NextResponse.json({ error: "缺少对话目标。" }, { status: 400 });
  }
  const loaded = await loadTarget(target);
  if (!loaded) return NextResponse.json({ error: "目标不存在。" }, { status: 404 });
  const session = await findAgentSession(target);
  const search = new URL(req.url).searchParams;
  const beforeRaw = search.get("before");
  const beforePosition =
    beforeRaw && Number.isFinite(Number(beforeRaw))
      ? Number(beforeRaw)
      : undefined;
  const limitRaw = search.get("limit");
  const limit =
    limitRaw && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined;
  const page = session
    ? await loadAgentMessages(session.id, { limit, beforePosition })
    : { messages: [], hasMore: false, oldestPosition: null };
  // 分页追加请求（带 before）：只返回消息页，避免重复拉 proposals/session/userInputs
  if (beforePosition !== undefined) {
    return NextResponse.json(page);
  }
  const proposals =
    target.kind === "article"
      ? await prisma.agentArticleProposal.findMany({
          where: { articleId: target.id },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            title: true,
            summary: true,
            status: true,
            createdAt: true,
            decidedAt: true,
          },
        })
      : await prisma.agentTechnicalDocumentProposal.findMany({
          where: { technicalDocumentId: target.id },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            title: true,
            summary: true,
            status: true,
            createdAt: true,
            decidedAt: true,
          },
        });
  // 用户历史输入缓存（仅取 user 消息文本，供对话框上下键导航）。
  // 限最近 50 条（position 倒序取后再翻正）：上下键历史足够用，避免长会话每次 refresh 全量扫描。
  const userMessages = session
    ? (
        await prisma.agentChatMessage.findMany({
          where: { sessionId: session.id, role: "user" },
          orderBy: { position: "desc" },
          take: 50,
          select: { partsJson: true, metadataJson: true },
        })
      ).reverse()
    : [];
  const userInputs = userMessages.flatMap((row) => {
    try {
      if (row.metadataJson) {
        const metadata = JSON.parse(row.metadataJson) as {
          composer?: unknown;
        };
        if (Array.isArray(metadata.composer)) return [metadata.composer];
      }
      const parts = JSON.parse(row.partsJson) as Array<{
        type?: string;
        text?: unknown;
      }>;
      const text = parts
        .filter((p) => p.type === "text")
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .join("");
      return text.trim() ? [[{ type: "text", text }]] : [];
    } catch {
      return [];
    }
  });

  return NextResponse.json({
    session,
    messages: page.messages,
    hasMore: page.hasMore,
    oldestPosition: page.oldestPosition,
    proposals: proposals.map((proposal) => ({
      ...proposal,
      proposalKind: target.kind,
    })),
    userInputs,
  });
}

export const POST = withApiLog("POST /api/ai/chat", async (req: NextRequest) => {
  const licenseBlocked = await requireLicenseForApi();
  if (licenseBlocked) return licenseBlocked;
  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Agent 请求参数无效。" }, { status: 400 });
  }
  const target = normalizeTarget(parsed.data);
  const loaded = await loadTarget(target);
  if (!loaded) return NextResponse.json({ error: "目标不存在。" }, { status: 404 });

  // 权威正文：优先用前端实时编辑区内容（currentMarkdown），避免 flush 时序导致读取到空/旧正文，
  // 也避免「当前文章从上下文消失」。前端未传（如个别调用方）时回落到 DB 读取。
  const articleMarkdown =
    typeof parsed.data.currentMarkdown === "string"
      ? parsed.data.currentMarkdown
      : (loaded.markdown ?? "");

  const session = await getOrCreateAgentSession(target);
  const turnGeneration = await captureSessionGeneration(session.id);
  const turnId = crypto.randomUUID();
  const turnStartedAt = new Date();
  const lease = await acquireTurnLease({
    sessionId: session.id,
    generation: turnGeneration,
    turnId,
    ttlMs: 120_000,
  });
  if (!lease.ok) {
    return NextResponse.json(
      { error: "已有一轮 Agent 对话正在运行，请稍后再试。", code: lease.reason },
      { status: lease.status }
    );
  }
  const uiMessages = parsed.data.messages as UIMessage[];
  const userText = lastUserText(uiMessages);
  const referencesArticle = referencesCurrentArticle(userText);
  const config = await getAgentConfig();
  // 合并前端（可能因 remount/分页截断）与 DB 历史，避免 delete-all-recreate 永久丢失旧消息。
  const initialMerge = await mergeAndPersistMessagesIfGenerationCurrent(
    session.id,
    turnGeneration,
    uiMessages,
    { activeTurnId: turnId }
  );
  if (initialMerge.ignored) {
    await releaseTurnLease({ sessionId: session.id, generation: turnGeneration, turnId });
    return NextResponse.json({ error: "对话已清空，请重试。" }, { status: 409 });
  }
  if (initialMerge.conflict === "initializing-client") {
    await releaseTurnLease({ sessionId: session.id, generation: turnGeneration, turnId });
    return NextResponse.json(
      { error: "客户端历史尚未初始化完成，请刷新后重试。", code: "initializing-client" },
      { status: 409 }
    );
  }
  const mergedMessages = initialMerge.messages ?? uiMessages;
  const runtimeMessages = replaceLastUserText(
    mergedMessages,
    parsed.data.messageOverride
  );

  log.info(
    {
      sessionId: session.id,
      targetKind: target.kind,
      targetId: target.id,
      messages: mergedMessages.length,
      providerId: parsed.data.providerId ?? null,
      modelId: parsed.data.modelId ?? null,
    },
    "Agent 对话开始"
  );

  // 能力/身份介绍类询问：本地短路，直接回精简能力清单。
  // 省 token、零延迟、文案稳定；未命中则交给 Claude Agent 自行判断。
  if (isCapabilityQuestion(userText)) {
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: mergedMessages,
      onFinish: async ({ messages }) => {
        try {
          // 基于最新 DB 合并后落盘：避免与并发轮次互相覆盖丢失回复（merge 保留历史前缀）。
          const result = await mergeAndPersistMessagesIfGenerationCurrent(
            session.id,
            turnGeneration,
            messages,
            { activeTurnId: turnId }
          );
          if (result.ignored || result.conflict) return;
        } catch (error) {
          // 持久化失败不阻断已返回给用户的流；前端内存仍持有本轮回复，下次发送经 merge 自愈。
          log.error(
            { err: error, sessionId: session.id },
            "onFinish 持久化失败（下次发送可自愈）"
          );
        } finally {
          await releaseTurnLease({ sessionId: session.id, generation: turnGeneration, turnId });
        }
      },
      onError: errorMessage,
      execute: async ({ writer }) => {
        const ew = createAgentEventWriter(writer, {
          turnId: crypto.randomUUID(),
          source: "inkpress-runtime",
        });
        writeStep(ew, {
          id: "capability",
          kind: "intent",
          title: "能力介绍",
          detail: "列出 Agent 可提供的能力范围",
        });
        const textId = crypto.randomUUID();
        ew.write({ type: "text-start", id: textId } as never);
        ew.write({
          type: "text-delta",
          id: textId,
          delta: CAPABILITY_REPLY,
        } as never);
        ew.write({ type: "text-end", id: textId } as never);
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  // 误触/乱码输入（纯符号、空内容、误触特殊字符）：本地短路，反问引导补充。
  if (isAccidentalInput(userText)) {
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: mergedMessages,
      onFinish: async ({ messages }) => {
        try {
          // 基于最新 DB 合并后落盘：避免与并发轮次互相覆盖丢失回复（merge 保留历史前缀）。
          const result = await mergeAndPersistMessagesIfGenerationCurrent(
            session.id,
            turnGeneration,
            messages,
            { activeTurnId: turnId }
          );
          if (result.ignored || result.conflict) return;
        } catch (error) {
          // 持久化失败不阻断已返回给用户的流；前端内存仍持有本轮回复，下次发送经 merge 自愈。
          log.error(
            { err: error, sessionId: session.id },
            "onFinish 持久化失败（下次发送可自愈）"
          );
        } finally {
          await releaseTurnLease({ sessionId: session.id, generation: turnGeneration, turnId });
        }
      },
      onError: errorMessage,
      execute: async ({ writer }) => {
        const ew = createAgentEventWriter(writer, {
          turnId: crypto.randomUUID(),
          source: "inkpress-runtime",
        });
        writeStep(ew, {
          id: "clarify",
          kind: "intent",
          title: "需要补充信息",
          detail: "输入不够明确，引导用户补充需求细节",
        });
        const textId = crypto.randomUUID();
        ew.write({ type: "text-start", id: textId } as never);
        ew.write({
          type: "text-delta",
          id: textId,
          delta: CLARIFY_REPLY,
        } as never);
        ew.write({ type: "text-end", id: textId } as never);
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  // 用户指代「当前文章/本文」但实时正文为空：直接明确提示，不让 Agent 反问「文章在哪里」或臆断。
  // 兼顾两种成因（编辑区确实空 / 内容尚未同步过来），都引导用户先写入或粘贴。
  if (referencesArticle && articleMarkdown.trim() === "") {
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: mergedMessages,
      onFinish: async ({ messages }) => {
        try {
          // 基于最新 DB 合并后落盘：避免与并发轮次互相覆盖丢失回复（merge 保留历史前缀）。
          const result = await mergeAndPersistMessagesIfGenerationCurrent(
            session.id,
            turnGeneration,
            messages,
            { activeTurnId: turnId }
          );
          if (result.ignored || result.conflict) return;
        } catch (error) {
          // 持久化失败不阻断已返回给用户的流；前端内存仍持有本轮回复，下次发送经 merge 自愈。
          log.error(
            { err: error, sessionId: session.id },
            "onFinish 持久化失败（下次发送可自愈）"
          );
        } finally {
          await releaseTurnLease({ sessionId: session.id, generation: turnGeneration, turnId });
        }
      },
      onError: errorMessage,
      execute: async ({ writer }) => {
        const ew = createAgentEventWriter(writer, {
          turnId: crypto.randomUUID(),
          source: "inkpress-runtime",
        });
        writeStep(ew, {
          id: "empty-article",
          kind: "intent",
          title: "当前文章为空",
          detail: "编辑区还没有可处理的正文，引导用户先写入或粘贴",
        });
        const textId = crypto.randomUUID();
        ew.write({ type: "text-start", id: textId } as never);
        ew.write({
          type: "text-delta",
          id: textId,
          delta: EMPTY_ARTICLE_REPLY,
        } as never);
        ew.write({ type: "text-end", id: textId } as never);
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  let turnUsage:
    | {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        cacheReadInputTokens?: number;
        cacheCreationInputTokens?: number;
        // P1.5：附加估算成本与状态，供聊天窗口 token chip 渲染（partial/error 可识别）。
        costUsd?: number;
        status?: "completed" | "partial" | "error";
        source?: "sdk-result" | "step-fallback";
      }
    | undefined;
  let assistantCheckpointUuid: string | undefined;
  try {
    // 先开流再做重活：路由（LLM）与代码源解析（含可能的 git clone/拉取历史）都放进 execute 内，
    // 避免在打开流之前同步阻塞导致长 TTFB 与「假死」；客户端断连时已发送的步骤也得以保留。
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: mergedMessages,
      onFinish: async ({ messages }) => {
        try {
          const persisted = messages.map((message, index) => {
            if (
              message.role !== "assistant" ||
              messages.slice(index + 1).some((item) => item.role === "assistant") ||
              (!turnUsage && !assistantCheckpointUuid)
            ) {
              return message;
            }
            return {
              ...message,
              metadata: {
                ...((message as { metadata?: Record<string, unknown> }).metadata ??
                  {}),
                ...(turnUsage ? { usage: turnUsage } : {}),
                ...(assistantCheckpointUuid
                  ? { claudeAgentMessageUuid: assistantCheckpointUuid }
                  : {}),
              },
            };
          });
          // 基于最新 DB 合并后落盘：避免与并发轮次互相覆盖丢失回复（merge 保留历史前缀）。
          const result = await mergeAndPersistMessagesIfGenerationCurrent(
            session.id,
            turnGeneration,
            persisted,
            { activeTurnId: turnId }
          );
          if (result.ignored || result.conflict) return;
        } catch (error) {
          // 持久化失败不阻断已返回给用户的流；前端内存仍持有本轮回复，下次发送经 merge 自愈。
          log.error(
            { err: error, sessionId: session.id },
            "onFinish 持久化失败（下次发送可自愈）"
          );
        } finally {
          await releaseTurnLease({ sessionId: session.id, generation: turnGeneration, turnId });
        }
      },
      onError: errorMessage,
      execute: async ({ writer }) => {
        // P0：包一层 seq 注入器，为本 turn 的 data/tool part 打上单调 seq + turnId + source。
        // 下游 runtime/adapter/MCP/canUseTool/工具 execute 都汇流到 ew，保证无断号。
        // P1.5：turnId 同时作为 AgentUsageTurn 的应用级轮次键（按 (sessionId, turnId) upsert）。
        const ew = createAgentEventWriter(writer, {
          turnId,
          source: "claude-agent-sdk",
        });
        const messageText = lastUserText(runtimeMessages);
        const articleBodyTokens = estimateTokens(
          `${loaded.title}\n${loaded.digest ?? loaded.documentType ?? ""}\n${articleMarkdown}`
        );
        const articleBodyTooLarge = articleBodyTokens > config.contextBudgetTokens * 0.65;
        // P3：斜杠命令 forceSkillIds 在前 + 文章 profile 的 defaultSkills 在后，合并去重。
        const profile = getArticleProfile(loaded.profileId);
        const preferredSkillIds = Array.from(
          new Set([...(parsed.data.forceSkillIds ?? []), ...profile.defaultSkills])
        ).slice(0, 8);
        const needsGitHistory = looksLikeGitHistoryRequest(messageText);
        let codeSource: CodeSourceReference | undefined;
        let approval:
          | {
              id: string;
              displayName: string;
              locator: string;
              approvalToken: string;
            }
          | undefined;
        /** 本地代码源仍待用户授权（含复用 pending grant、无新 token 下发的情况）。 */
        let awaitingApproval = false;
        const codeSourceCandidate = extractCodeSourceCandidate(
          messageText,
          config.projects
        );

        if (codeSourceCandidate) {
          const resolved = await createOrReuseCodeSourceGrant({
            sessionId: session.id,
            candidate: codeSourceCandidate,
          });
          if (resolved.grant.status === "approved") {
            const source = await codeSourceProject(resolved.grant.id, config, {
              historyDepth: needsGitHistory ? 200 : 1,
            });
            codeSource = source.source;
          } else if (resolved.grant.status === "pending") {
            awaitingApproval = true;
            if (resolved.approvalToken) {
              approval = {
                id: resolved.grant.id,
                displayName: resolved.grant.displayName,
                locator: resolved.grant.locator,
                approvalToken: resolved.approvalToken,
              };
            }
          }
        } else {
          const previous = await prisma.codeSourceGrant.findFirst({
            where: { sessionId: session.id, status: "approved" },
            orderBy: { lastAccessedAt: "desc" },
          });
          if (previous) {
            const source = await codeSourceProject(previous.id, config, {
              historyDepth: needsGitHistory ? 200 : 1,
            });
            codeSource = source.source;
          }
        }

        const context = {
          estimatedTokens:
            articleBodyTokens +
            estimateTokens(session.summary) +
            estimateUiMessagesTokens(mergedMessages),
          articleTokens: articleBodyTokens,
          compressed: false,
          retainedMessages: mergedMessages.length,
        };
        if (codeSourceCandidate) {
          ew.write({
            type: "data-code-source-detected",
            id: "code-source-detected",
            data: {
              kind: codeSourceCandidate.kind,
              displayName: codeSourceCandidate.displayName,
              locator: codeSourceCandidate.locator,
            },
          } as never);
        }
        if (approval) {
          ew.write({
            type: "data-code-source-approval",
            id: `code-source-approval-${approval.id}`,
            data: approval,
          } as never);
        } else if (codeSource) {
          ew.write({
            type: "data-code-source-ready",
            id: `code-source-ready-${codeSource.id}`,
            data: {
              id: codeSource.id,
              kind: codeSource.kind,
              displayName: codeSource.displayName,
              locator: codeSource.locator,
              ref: codeSource.ref,
            },
          } as never);
        }
        // 按需载入正文时，显式提示已注入实时编辑区正文（含字数），让用户确认上下文已就位。
        if (articleMarkdown.trim() !== "") {
          writeStep(ew, {
            id: "current-article",
            kind: "intent",
            title: "已载入当前文章",
            detail: `已注入实时编辑区正文（约 ${articleMarkdown.length.toLocaleString()} 字）`,
          });
          if (articleBodyTooLarge) {
            // 系统提示会截断超长正文；完整跨轮上下文由 Claude Agent SDK session/autocompact 管理。
            writeStep(ew, {
              id: "current-article-digest",
              kind: "intent",
              title: "正文较长，已按预算截断注入",
              detail: `当前文章约 ${articleBodyTokens.toLocaleString()} tokens，Claude Agent 会结合会话上下文与工具继续处理`,
            });
          }
        } else if (articleBodyTooLarge) {
          writeStep(ew, {
            id: "current-article-digest",
            kind: "intent",
            title: "正文较长",
            detail: `当前文章约 ${articleBodyTokens.toLocaleString()} tokens`,
          });
        }
        ew.write({
          type: "data-context-usage",
          id: "context",
          data: {
            estimatedTokens: context.estimatedTokens,
            articleTokens: context.articleTokens,
            compressed: context.compressed,
            retainedMessages: context.retainedMessages,
          },
        } as never);

        if (awaitingApproval) {
          // 授权交互由 data-code-source-approval → CodeSourceApprovalCard 承载；
          // 复用 pending grant 时不重复下发 part（客户端仍持有首次 token）。
          return;
        }

        const requestedProviderId = parsed.data.providerId ?? null;
        const requestedModelId = parsed.data.modelId ?? null;
        const selectedLlm = await chooseLlmConfig(
          requestedProviderId,
          requestedModelId
        );
        if (!selectedLlm) {
          throw new Error(
            "未配置 AI 模型：请在「设置 → 系统配置 → AI 模型」中添加至少一个 Anthropic 兼容供应商并填入 API Key。"
          );
        }

        // 跨模型 resume 风险处理：若本轮最终生效的 provider/model 与上一轮不同，
        // 且已有 SDK 会话，则强制开启新会话（SDK transcript 跨厂商回放有风险）。
        const newProviderId = selectedLlm.id;
        const newModelId = selectedLlm.model.id;
        log.info(
          {
            sessionId: session.id,
            requestedProviderId,
            requestedModelId,
            providerId: newProviderId,
            modelId: newModelId,
          },
          "已解析本轮 AI 模型"
        );
        const previousProviderId = session.providerId ?? newProviderId;
        const previousModelId = session.modelId ?? newModelId;
        const modelChanged =
          !!session.claudeAgentSessionId &&
          (previousProviderId !== newProviderId || previousModelId !== newModelId);
        const mirrorDegraded = session.claudeAgentSessionStatus === "degraded";
        const forceNewSession = parsed.data.restartSession || mirrorDegraded;
        let effectiveClaudeAgentSessionId = forceNewSession
          ? undefined
          : session.claudeAgentSessionId ?? undefined;
        if (modelChanged) {
          effectiveClaudeAgentSessionId = undefined;
          writeStep(ew, {
            id: "model-switched",
            kind: "intent",
            title: "模型已切换，开启新的 Agent 会话",
            detail: "切换模型后无法回放上一模型的上下文，已自动开启新会话",
          });
        }
        if (mirrorDegraded) {
          writeStep(ew, {
            id: "session-mirror-degraded",
            kind: "intent",
            title: "会话镜像不完整，开启新的 Agent 会话",
            detail: "上一轮 SessionStore 镜像失败，为避免不完整恢复，本轮从当前消息重新开始",
          });
        }

        const runningUpdate = await prisma.agentChatSession.updateMany({
          where: { id: session.id, generation: turnGeneration, activeTurnId: turnId },
          data: {
            selectedProjectId: session.selectedProjectId,
            providerId: newProviderId,
            modelId: newModelId,
            ...(modelChanged || forceNewSession
              ? { claudeAgentSessionId: null, claudeAgentStoreKey: null }
              : {}),
            // P2 状态机：本轮开跑 → running。若上一轮已落 claudeAgentSessionId，本轮即 resume（PDC §5）。
            claudeAgentSessionStatus: "running",
            claudeAgentLastError: null,
            ...(effectiveClaudeAgentSessionId
              ? { claudeAgentResumeCount: { increment: 1 } }
              : {}),
          },
        });
        if (runningUpdate.count === 0) return;

        try {
          const outcome = await runClaudeAgentRuntime(
            {
              target: {
                kind: target.kind,
                id: target.id,
                title: loaded.title,
                markdown: articleMarkdown,
                digest: loaded.digest,
                documentType: loaded.documentType,
                snapshotHash: loaded.snapshotHash,
                profileId: loaded.profileId ?? undefined,
                contentRevision: loaded.contentRevision,
              },
              sessionId: session.id,
              codeSource,
              claudeAgentSessionId: effectiveClaudeAgentSessionId,
              claudeAgentResumeSessionAt: parsed.data.resumeSessionAt,
              preferredSkillIds,
              providerId: newProviderId,
              modelId: newModelId,
              messages: runtimeMessages,
              // 主动早于路由 maxDuration 收口，避免 SDK 无终止事件时客户端永久 streaming。
              abortSignal: createRunAbortSignal(req.signal, 110_000),
            },
            ew
          );
          const completedSessionId =
            outcome.sessionId ?? effectiveClaudeAgentSessionId ?? null;
          assistantCheckpointUuid = outcome.assistantMessageUuid;
          if (outcome.usage) {
            turnUsage = {
              ...outcome.usage,
              totalTokens: outcome.usageSummary?.totalTokens ?? outcome.usage.totalTokens,
              cacheReadInputTokens: outcome.usageSummary?.cacheReadInputTokens,
              cacheCreationInputTokens: outcome.usageSummary?.cacheCreationInputTokens,
              costUsd: outcome.usageSummary?.costUsd,
              status: outcome.usageSummary?.status,
              source: outcome.usageSummary?.source,
            };
            ew.write({
              type: "data-turn-usage",
              id: "turn-usage",
              data: turnUsage,
            } as never);
          }
          // 成功结束时无论 SDK 是否返回 usage，都要保存 sessionId/status（PDC §5.1/§7.3）。
          // last*Tokens 仅作 composer 计量快捷显示，不是历史统计事实源（PDC §12.3）。
          const readyUpdate = await prisma.agentChatSession.updateMany({
            where: { id: session.id, generation: turnGeneration, activeTurnId: turnId },
            data: {
              ...(outcome.usage
                ? {
                    lastInputTokens: outcome.usage.inputTokens,
                    lastOutputTokens: outcome.usage.outputTokens,
                    lastReasoningTokens: outcome.usage.reasoningTokens,
                    lastTotalTokens: outcome.usage.totalTokens,
                  }
                : {}),
              runtime: "claude-agent",
              ...(completedSessionId
                ? { claudeAgentSessionId: completedSessionId }
                : {}),
              // SessionStore mirror 失败时不能声称可无损 resume；下一轮会显式开新会话。
              claudeAgentSessionStatus:
                outcome.mirrorHealthy === false ? "degraded" : "ready",
              claudeAgentLastEventAt: new Date(),
              claudeAgentLastError:
                outcome.mirrorHealthy === false ? "会话镜像不完整" : null,
              claudeAgentInterruptedAt: null,
            },
          });
          if (readyUpdate.count === 0) return;
          // 独立 usage ledger：正常完成也写入（status=completed）。
          if (outcome.usageSummary) {
            const usageWrite = await upsertUsageTurnIfSessionGenerationCurrent(
              {
                sessionId: session.id,
                turnId,
                targetKind: target.kind,
                targetId: target.id,
                providerId: newProviderId,
                modelId: newModelId,
                sdkSessionId: completedSessionId,
                startedAt: turnStartedAt,
                metadata: outcome.runtimeMetadata,
              },
              outcome.usageSummary,
              turnGeneration
            ).catch((error) =>
              log.warn(
                { err: error, sessionId: session.id },
                "AgentUsageTurn 写入失败（不阻断对话）"
              )
            );
            if (usageWrite?.ignored) return;
          }
        } catch (error) {
          // 失败/中断轮次：runtime 已把 usage summary + sessionId 挂到 error 上（PDC §7.2/§7.3）。
          // 即便 result 前 abort（仅收到 system/init），只要有 SDK session id 就落库，保证下一轮可 resume。
          const summary = readUsageFromError(error);
          const runtimeMetadata = readRuntimeMetadataFromError(error);
          const mirrorHealthy = readMirrorHealthyFromError(error);
          const sdkSessionId =
            readSessionFromError(error) ?? effectiveClaudeAgentSessionId ?? null;
          // 状态必须在错误/中断三路都落库；即便 sessionId 与旧值相同，也要从 running 收口到
          // interrupted/error（PDC §7.3），否则 UI 会误判为仍在运行。
          const errorUpdate = await prisma.agentChatSession
            .updateMany({
              where: { id: session.id, generation: turnGeneration, activeTurnId: turnId },
              data: {
                ...(sdkSessionId ? { claudeAgentSessionId: sdkSessionId } : {}),
                // P2 状态机：中断 → interrupted（可继续）；错误 → error（可能可继续）。
                claudeAgentSessionStatus: isAbortError(error)
                  ? "interrupted"
                  : "error",
                claudeAgentLastEventAt: new Date(),
                ...(isAbortError(error)
                  ? { claudeAgentInterruptedAt: new Date() }
                  : { claudeAgentLastError: errorMessage(error) }),
              },
            })
            .catch((writeError) =>
              log.warn(
                { err: writeError, sessionId: session.id },
                sdkSessionId
                  ? "claudeAgentSessionId 写入失败（不阻断对话）"
                  : "会话状态写入失败（不阻断对话）"
              )
            );
          if (errorUpdate?.count === 0) return;
          if (summary) {
            // 仍记入 ledger（PDC §12.4：成功、错误 result 都要记录 usage；中断用 step fallback 兜底）。
            turnUsage = {
              inputTokens: summary.inputTokens,
              outputTokens: summary.outputTokens,
              reasoningTokens: 0,
              totalTokens: summary.totalTokens,
              cacheReadInputTokens: summary.cacheReadInputTokens,
              cacheCreationInputTokens: summary.cacheCreationInputTokens,
              costUsd: summary.costUsd,
              status: summary.status,
              source: summary.source,
            };
            ew.write({
              type: "data-turn-usage",
              id: "turn-usage",
              data: turnUsage,
            } as never);
            const usageWrite = await upsertUsageTurnIfSessionGenerationCurrent(
              {
                sessionId: session.id,
                turnId,
                targetKind: target.kind,
                targetId: target.id,
                providerId: newProviderId,
                modelId: newModelId,
                sdkSessionId,
                startedAt: turnStartedAt,
                metadata: {
                  ...(runtimeMetadata ?? {}),
                  ...(mirrorHealthy === false ? { mirrorHealthy: false } : {}),
                },
              },
              summary,
              turnGeneration
            ).catch((writeError) =>
              log.warn(
                { err: writeError, sessionId: session.id },
                "AgentUsageTurn 写入失败（不阻断对话）"
              )
            );
            if (usageWrite?.ignored) return;
          }
          throw error;
        }
        return;
      },
    });
    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    log.error(
      { err: error, sessionId: session.id, targetId: target.id },
      "Agent 对话失败"
    );
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
});

export async function DELETE(req: NextRequest) {
  const target = targetFromQuery(req);
  if (!target) {
    return NextResponse.json({ error: "缺少对话目标。" }, { status: 400 });
  }
  const session = await prisma.agentChatSession.findFirst({
    where:
      target.kind === "article"
        ? { articleId: target.id }
        : { technicalDocumentId: target.id },
  });
  if (session) {
    const pendingToolGrants = await prisma.toolActionGrant.findMany({
      where: { sessionId: session.id, status: "pending" },
      select: { id: true },
    });
    for (const grant of pendingToolGrants) abortApproval(grant.id);

    const sdkSessionId = session.claudeAgentSessionId;
    await prisma.$transaction([
      prisma.agentChatMessage.deleteMany({ where: { sessionId: session.id } }),
      prisma.snippetInjectionReview.deleteMany({
        where: { sessionId: session.id },
      }),
      // 提案硬删（防 DB 膨胀）：应用过的正文已在文章文件/技术文档版本里，不依赖提案行
      target.kind === "article"
        ? prisma.agentArticleProposal.deleteMany({
            where: { sessionId: session.id },
          })
        : prisma.agentTechnicalDocumentProposal.deleteMany({
            where: { sessionId: session.id },
          }),
      prisma.agentChatSession.update({
        where: { id: session.id },
        data: {
          generation: { increment: 1 },
          activeTurnId: null,
          activeTurnExpiresAt: null,
          summary: "",
          summaryUpToPosition: -1,
          selectedProjectId: null,
          providerId: null,
          modelId: null,
          claudeAgentSessionId: null,
          claudeAgentStoreKey: null,
          // P2：清空当前 Claude resume 入口 → 下一轮开新 SDK session（PDC §5.4/§9）。
          // 状态置 cleared 让前端提示「将开启新会话」；绝不清 AgentUsageTurn（重点目标 #8）。
          claudeAgentSessionStatus: "cleared",
          claudeAgentLastEventAt: null,
          claudeAgentLastError: null,
          claudeAgentInterruptedAt: null,
          lastInputTokens: 0,
          lastOutputTokens: 0,
          lastReasoningTokens: 0,
          lastTotalTokens: 0,
        },
      }),
      prisma.codeSourceGrant.deleteMany({ where: { sessionId: session.id } }),
      prisma.toolActionGrant.deleteMany({ where: { sessionId: session.id } }),
      ...(sdkSessionId
        ? [
            prisma.claudeAgentSessionEntry.deleteMany({
              where: { sdkSessionId },
            }),
          ]
        : []),
    ]);
  }
  return NextResponse.json({ ok: true });
}
