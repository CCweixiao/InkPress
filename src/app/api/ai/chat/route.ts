import { NextRequest, NextResponse } from "next/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  readContent,
  readTechnicalDocumentContent,
} from "@/lib/content-store";
import { getAgentConfig } from "@/lib/ai/agent-config";
import {
  getOrCreateAgentSession,
  loadAgentMessages,
  mergeAndPersistMessages,
  type AgentTarget,
} from "@/lib/ai/chat-persistence";
import { createWritingAgent } from "@/lib/ai/writing-agent";
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
  shouldIncludeArticleBody,
} from "@/lib/ai/current-article";
import { getModel } from "@/lib/ai/provider";
import { listSkills, loadSkill } from "@/lib/ai/skills";
import { routeAgentRequest } from "@/lib/ai/agent-orchestrator";
import { estimateTokens, prepareAgentContext } from "@/lib/ai/context-manager";
import { parseTags } from "@/lib/asset";
import {
  codeSourceProject,
  createOrReuseCodeSourceGrant,
  type CodeSourceReference,
} from "@/lib/ai/code-source";
import { moduleLogger } from "@/lib/logger";
import { withApiLog } from "@/lib/api-log";

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
    // 斜杠命令 /<skill> 强制加载的 Skill（最多 4 个，与意图路由 skillIds 一致）。
    forceSkillIds: z.array(z.string().min(1)).max(4).optional(),
    // 实时编辑区正文：权威来源，覆盖 DB 读取，避免 flush 时序导致 Agent 拿到空/旧正文。
    currentMarkdown: z.string().nullable().optional(),
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
        ? await readContent(article.id)
        : article.contentMd,
      digest: article.digest ?? "",
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

/** 提取某条消息的纯文本（仅 text part），供路由上下文使用。 */
function messagePlainText(message: UIMessage) {
  return (message.parts ?? [])
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

/**
 * 构造意图路由器的会话上下文：session 摘要 + 最近若干轮文本（不含本轮当前消息）。
 * 仅取 text part 并截断，保持轻量；让路由器能正确处理依赖上文的跟随指令。
 */
function buildRouterContext(
  sessionSummary: string,
  messages: UIMessage[],
  recentTurns = 4
): string {
  const segments: string[] = [];
  if (sessionSummary.trim()) {
    segments.push(`对话历史摘要：\n${sessionSummary.trim().slice(0, 1200)}`);
  }
  // 排除最后一条（即本轮当前用户消息，路由器已单独拿到），取其前的最近若干条。
  const prior = messages.slice(0, -1).slice(-recentTurns);
  const transcript = prior
    .map((message) => {
      const text = messagePlainText(message);
      if (!text) return null;
      return `${message.role === "user" ? "用户" : "助手"}：${text.slice(0, 300)}`;
    })
    .filter(Boolean)
    .join("\n");
  if (transcript) segments.push(`最近对话：\n${transcript}`);
  return segments.join("\n\n");
}

function errorMessage(error: unknown) {
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

// 意图枚举 → 中文标签，供「识别任务意图」步骤展示，避免直接露出英文枚举。
const INTENT_LABEL: Record<string, string> = {
  question: "问答",
  "create-article": "创作文章",
  polish: "润色",
  review: "审校",
  research: "调研",
  "project-explore": "项目探索",
  "write-technical-doc": "技术文档",
  "project-to-article": "项目转文章",
  "project-change-analysis": "变更分析",
  "write-change-document": "变更文档",
  "change-to-article": "变更转文章",
  summarize: "生成摘要",
  "out-of-scope": "超出能力范围",
};

function intentLabel(intent: string) {
  return INTENT_LABEL[intent] ?? intent;
}

// 超范围请求的兜底拒绝文案（优先使用 LLM 给出的 rationale）。
const OUT_OF_SCOPE_REPLY =
  "抱歉，这个请求超出了我的能力范围。我是公众号与技术文档写作助手，擅长：\n" +
  "- 创作、润色、审校公众号文章\n" +
  "- 围绕代码项目做只读分析，整理成技术文档或公众号文章\n" +
  "- 分析 Git 提交与变更，写成版本复盘文章\n" +
  "- 联网调研辅助写作\n\n" +
  "我不能修改或编写源代码、执行命令、操作数据库、处理支付转账或执行系统运维。" +
  "如果你希望把这个主题写成文章，请告诉我，我很乐意帮忙。";

export async function GET(req: NextRequest) {
  const target = targetFromQuery(req);
  if (!target) {
    return NextResponse.json({ error: "缺少对话目标。" }, { status: 400 });
  }
  const loaded = await loadTarget(target);
  if (!loaded) return NextResponse.json({ error: "目标不存在。" }, { status: 404 });
  const session = await getOrCreateAgentSession(target);
  const search = new URL(req.url).searchParams;
  const beforeRaw = search.get("before");
  const beforePosition =
    beforeRaw && Number.isFinite(Number(beforeRaw))
      ? Number(beforeRaw)
      : undefined;
  const limitRaw = search.get("limit");
  const limit =
    limitRaw && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined;
  const page = await loadAgentMessages(session.id, { limit, beforePosition });
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
  const userMessages = (
    await prisma.agentChatMessage.findMany({
      where: { sessionId: session.id, role: "user" },
      orderBy: { position: "desc" },
      take: 50,
      select: { partsJson: true },
    })
  ).reverse();
  const userInputs = userMessages.flatMap((row) => {
    try {
      const parts = JSON.parse(row.partsJson) as Array<{
        type?: string;
        text?: unknown;
      }>;
      return parts
        .filter((p) => p.type === "text")
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .filter((t) => t.trim() !== "");
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

  const uiMessages = parsed.data.messages as UIMessage[];
  const userText = lastUserText(uiMessages);
  const referencesArticle = referencesCurrentArticle(userText);
  const session = await getOrCreateAgentSession(target);
  const config = await getAgentConfig();
  // 合并前端（可能因 remount/分页截断）与 DB 历史，避免 delete-all-recreate 永久丢失旧消息。
  const mergedMessages = await mergeAndPersistMessages(session.id, uiMessages);

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

  // 能力/身份介绍类询问：预路由短路，跳过意图路由与 Agent，直接回精简能力清单。
  // 省 token、零延迟、文案稳定；未命中则照常进入下方意图路由（question 兜底即普通对话）。
  if (isCapabilityQuestion(userText)) {
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: mergedMessages,
      onFinish: async ({ messages }) => {
        try {
          // 基于最新 DB 合并后落盘：避免与并发轮次互相覆盖丢失回复（merge 保留历史前缀）。
          await mergeAndPersistMessages(session.id, messages);
        } catch (error) {
          // 持久化失败不阻断已返回给用户的流；前端内存仍持有本轮回复，下次发送经 merge 自愈。
          log.error(
            { err: error, sessionId: session.id },
            "onFinish 持久化失败（下次发送可自愈）"
          );
        }
      },
      onError: errorMessage,
      execute: async ({ writer }) => {
        writeStep(writer, {
          id: "capability",
          kind: "intent",
          title: "能力介绍",
          detail: "列出 Agent 可提供的能力范围",
        });
        const textId = crypto.randomUUID();
        writer.write({ type: "text-start", id: textId } as never);
        writer.write({
          type: "text-delta",
          id: textId,
          delta: CAPABILITY_REPLY,
        } as never);
        writer.write({ type: "text-end", id: textId } as never);
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  // 误触/乱码输入（纯符号、空内容、误触特殊字符）：预路由短路，反问引导补充，不浪费 LLM 去硬猜。
  if (isAccidentalInput(userText)) {
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: mergedMessages,
      onFinish: async ({ messages }) => {
        try {
          // 基于最新 DB 合并后落盘：避免与并发轮次互相覆盖丢失回复（merge 保留历史前缀）。
          await mergeAndPersistMessages(session.id, messages);
        } catch (error) {
          // 持久化失败不阻断已返回给用户的流；前端内存仍持有本轮回复，下次发送经 merge 自愈。
          log.error(
            { err: error, sessionId: session.id },
            "onFinish 持久化失败（下次发送可自愈）"
          );
        }
      },
      onError: errorMessage,
      execute: async ({ writer }) => {
        writeStep(writer, {
          id: "clarify",
          kind: "intent",
          title: "需要补充信息",
          detail: "输入不够明确，引导用户补充需求细节",
        });
        const textId = crypto.randomUUID();
        writer.write({ type: "text-start", id: textId } as never);
        writer.write({
          type: "text-delta",
          id: textId,
          delta: CLARIFY_REPLY,
        } as never);
        writer.write({ type: "text-end", id: textId } as never);
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
          await mergeAndPersistMessages(session.id, messages);
        } catch (error) {
          // 持久化失败不阻断已返回给用户的流；前端内存仍持有本轮回复，下次发送经 merge 自愈。
          log.error(
            { err: error, sessionId: session.id },
            "onFinish 持久化失败（下次发送可自愈）"
          );
        }
      },
      onError: errorMessage,
      execute: async ({ writer }) => {
        writeStep(writer, {
          id: "empty-article",
          kind: "intent",
          title: "当前文章为空",
          detail: "编辑区还没有可处理的正文，引导用户先写入或粘贴",
        });
        const textId = crypto.randomUUID();
        writer.write({ type: "text-start", id: textId } as never);
        writer.write({
          type: "text-delta",
          id: textId,
          delta: EMPTY_ARTICLE_REPLY,
        } as never);
        writer.write({ type: "text-end", id: textId } as never);
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
      }
    | undefined;
  try {
    // 先开流再做重活：路由（LLM）与代码源解析（含可能的 git clone/拉取历史）都放进 execute 内，
    // 避免在打开流之前同步阻塞导致长 TTFB 与「假死」；客户端断连时已发送的步骤也得以保留。
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: mergedMessages,
      onFinish: async ({ messages }) => {
        try {
          const persisted = messages.map((message, index) => {
            if (
              !turnUsage ||
              message.role !== "assistant" ||
              messages.slice(index + 1).some((item) => item.role === "assistant")
            ) {
              return message;
            }
            return {
              ...message,
              metadata: {
                ...((message as { metadata?: Record<string, unknown> }).metadata ??
                  {}),
                usage: turnUsage,
              },
            };
          });
          // 基于最新 DB 合并后落盘：避免与并发轮次互相覆盖丢失回复（merge 保留历史前缀）。
          await mergeAndPersistMessages(session.id, persisted);
        } catch (error) {
          // 持久化失败不阻断已返回给用户的流；前端内存仍持有本轮回复，下次发送经 merge 自愈。
          log.error(
            { err: error, sessionId: session.id },
            "onFinish 持久化失败（下次发送可自愈）"
          );
        }
      },
      onError: errorMessage,
      execute: async ({ writer }) => {
        // 先发「识别意图」运行态，立即给用户反馈（下面的路由/代码源解析可能耗时）。
        writeStep(writer, {
          id: "intent",
          kind: "intent",
          title: "识别任务意图",
          detail: "正在分析意图与所需能力…",
          status: "running",
        });
        const { model } = await getModel(
          parsed.data.providerId,
          parsed.data.modelId
        );
        const skills = await listSkills();
        const route = await routeAgentRequest({
          model,
          message: lastUserText(mergedMessages),
          skills,
          config,
          previousProjectId: session.selectedProjectId,
          targetKind: target.kind,
          conversationContext: buildRouterContext(session.summary, mergedMessages),
        });

        // 按需注入正文：默认带全文；仅与正文无关的意图（联网/代码）且用户未指代当前文章时省略全文，省 token。
        let includeArticleBody = shouldIncludeArticleBody(
          route.intent,
          referencesArticle
        );

        // 长正文降级：若全文已超出安全上下文预算，不再硬抛错阻断整轮对话，
        // 改为退回「概要（标题+摘要+大纲）」（writing-agent 的 articleDescriptor），
        // 仍能对长文做问答/规划，仅逐字改写场景才提示换模型。
        const articleBodyTokens = estimateTokens(
          `${loaded.title}\n${loaded.digest ?? loaded.documentType ?? ""}\n${articleMarkdown}`
        );
        const articleBodyTooLarge =
          articleBodyTokens > config.contextBudgetTokens * 0.65;
        if (includeArticleBody && articleBodyTooLarge) {
          includeArticleBody = false;
        }

        // 斜杠命令 /<skill>：强制加载用户指定的 Skill（优先级最高，去重后并入路由结果，限 4 个）。
        // 仅接受已注册的 skillKey/id；强制 Skill 需要工具链路里的 load_skill 能力。
        if (parsed.data.forceSkillIds?.length) {
          const availableSkillIds = new Set(
            skills.flatMap((skill) => [skill.id, skill.skillKey])
          );
          const forced = parsed.data.forceSkillIds.filter((id) =>
            availableSkillIds.has(id)
          );
          if (forced.length) {
            route.skillIds = Array.from(
              new Set([...forced, ...route.skillIds])
            ).slice(0, 4);
            if (!route.activeTools.includes("load_skill")) {
              route.activeTools.push("load_skill");
            }
          }
        }
        let codeSource: CodeSourceReference | undefined;
        let approval:
          | {
              id: string;
              displayName: string;
              locator: string;
              approvalToken: string;
            }
          | undefined;

        // 代码源解析可能较慢（首次 clone / 拉取历史）：先发运行态步骤再解析。
        if (route.codeSourceCandidate || route.project || route.needsProject) {
          writeStep(writer, {
            id: "project",
            kind: "project",
            title: "识别代码源",
            detail: "正在解析代码源…",
            status: "running",
          });
        }

        if (route.codeSourceCandidate) {
          const resolved = await createOrReuseCodeSourceGrant({
            sessionId: session.id,
            candidate: route.codeSourceCandidate,
          });
          if (resolved.grant.status === "approved") {
            const source = await codeSourceProject(resolved.grant.id, config, {
              historyDepth: route.needsGitHistory ? 200 : 1,
            });
            route.project = source.project;
            route.codeSource = source.source;
            codeSource = source.source;
            route.ambiguityQuestion = undefined;
          } else if (resolved.approvalToken) {
            approval = {
              id: resolved.grant.id,
              displayName: resolved.grant.displayName,
              locator: resolved.grant.locator,
              approvalToken: resolved.approvalToken,
            };
            route.ambiguityQuestion = undefined;
          }
        } else if (route.project) {
          const resolved = await createOrReuseCodeSourceGrant({
            sessionId: session.id,
            candidate: {
              kind: "configured-project",
              locator: route.project.root,
              projectId: route.project.id,
              root: route.project.root,
              displayName: route.project.name,
            },
          });
          const source = await codeSourceProject(resolved.grant.id, config, {
            historyDepth: route.needsGitHistory ? 200 : 1,
          });
          route.project = source.project;
          route.codeSource = source.source;
          codeSource = source.source;
        } else if (route.needsProject) {
          const previous = await prisma.codeSourceGrant.findFirst({
            where: { sessionId: session.id, status: "approved" },
            orderBy: { lastAccessedAt: "desc" },
          });
          if (previous) {
            const source = await codeSourceProject(previous.id, config, {
              historyDepth: route.needsGitHistory ? 200 : 1,
            });
            route.project = source.project;
            route.codeSource = source.source;
            codeSource = source.source;
            route.ambiguityQuestion = undefined;
          }
        }

        if (route.project) {
          if (!route.activeTools.includes("explore_project")) {
            route.activeTools.push("explore_project");
          }
          if (
            route.needsGitHistory &&
            !route.activeTools.includes("analyze_code_changes")
          ) {
            route.activeTools.push("analyze_code_changes");
          }
          if (
            codeSource?.kind === "github" &&
            !route.activeTools.includes("github_pull_request")
          ) {
            route.activeTools.push("github_pull_request");
          }
        }
        const loadedSkills = await Promise.all(
          route.skillIds.map((id) => loadSkill(id))
        );
        // 文章目标始终加载素材：意图路由可能把写作请求误判为 question，
        // 但只要目标是文章且上传了素材，就应让 Agent 看到素材列表并按需插图。
        const assets =
          target.kind === "article"
            ? await prisma.asset.findMany({
                where: { articleId: target.id, trashed: false },
                select: {
                  id: true,
                  name: true,
                  url: true,
                  kind: true,
                  description: true,
                  tagsJson: true,
                },
                orderBy: { createdAt: "desc" },
                take: 50,
              })
            : [];
        const assetCatalog = assets.map((asset) => ({
          id: asset.id,
          name: asset.name,
          url: asset.url,
          kind: asset.kind,
          description: asset.description,
          tags: parseTags(asset.tagsJson),
        }));

        await prisma.agentChatSession.update({
          where: { id: session.id },
          data: {
            selectedProjectId: route.project?.id ?? session.selectedProjectId,
            providerId: parsed.data.providerId ?? null,
            modelId: parsed.data.modelId ?? null,
          },
        });

        // system prompt 的可变大块：已加载 Skill 手册 + 素材目录。纳入上下文估算，
        // 避免 TokenMeter 低估与 shouldSummarize 阈值失真（system prompt 同样占用预算）。
        const systemExtraText = [
          ...loadedSkills.map(
            (skill) => `${skill.name}\n${skill.description}\n${skill.manual}`
          ),
          ...assetCatalog.map(
            (asset) =>
              `${asset.name} ${asset.kind} ${asset.description ?? ""} ${asset.tags.join(" ")}`
          ),
        ].join("\n");

        const context = await prepareAgentContext({
          model,
          sessionId: session.id,
          sessionSummary: session.summary,
          summaryUpToPosition: session.summaryUpToPosition,
          uiMessages: mergedMessages,
          articleText: includeArticleBody
            ? `${loaded.title}\n${loaded.digest ?? loaded.documentType ?? ""}\n${articleMarkdown}`
            : "",
          contextBudgetTokens: config.contextBudgetTokens,
          systemExtraText,
        });

        // 意图识别完成：覆盖同 id 的运行态步骤为完成态（含意图与路由说明）。
        writeStep(writer, {
          id: "intent",
          kind: "intent",
          title: "识别任务意图",
          detail: `${intentLabel(route.intent)} · ${route.rationale}`,
        });
        writeStep(writer, {
          id: "project",
          kind: "project",
          title: "识别代码源",
          detail: codeSource
            ? `已选择 ${codeSource.displayName}（${codeSource.kind === "github" ? "GitHub 公开仓库缓存" : "本地严格只读"}）`
            : approval
              ? `检测到 ${approval.displayName}，等待首次授权`
            : route.needsProject
              ? "需要确认项目"
              : "本轮无需读取代码源",
        });
        if (route.codeSourceCandidate) {
          writer.write({
            type: "data-code-source-detected",
            id: "code-source-detected",
            data: {
              kind: route.codeSourceCandidate.kind,
              displayName: route.codeSourceCandidate.displayName,
              locator: route.codeSourceCandidate.locator,
            },
          } as never);
        }
        if (approval) {
          writer.write({
            type: "data-code-source-approval",
            id: `code-source-approval-${approval.id}`,
            data: approval,
          } as never);
        } else if (codeSource) {
          writer.write({
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
        writeStep(writer, {
          id: "skills",
          kind: "skill",
          title: "加载专业 Skill",
          detail: loadedSkills.length
            ? loadedSkills.map((skill) => skill.name).join("、")
            : "本轮无需额外 Skill",
        });
        if (target.kind === "article") {
          writeStep(writer, {
            id: "assets",
            kind: "assets",
            title: "扫描文章素材",
            detail:
              assetCatalog.length > 0
                ? `已注入 ${assetCatalog.length} 项素材`
                : "当前文章暂无素材",
          });
        }
        // 按需载入正文时，显式提示已注入实时编辑区正文（含字数），让用户确认上下文已就位。
        if (includeArticleBody && articleMarkdown.trim() !== "") {
          writeStep(writer, {
            id: "current-article",
            kind: "intent",
            title: "已载入当前文章",
            detail: `已注入实时编辑区正文（约 ${articleMarkdown.length.toLocaleString()} 字）`,
          });
        } else if (articleBodyTooLarge && articleMarkdown.trim() !== "") {
          // 长正文已降级为概要：明确告知用户，逐字改写需换更长上下文模型。
          writeStep(writer, {
            id: "current-article-digest",
            kind: "intent",
            title: "正文过长，已改用概要",
            detail: `当前文章约 ${articleBodyTokens.toLocaleString()} tokens 超出安全预算，已退回「标题+摘要+大纲」概要；如需逐字改写全文请切换更长上下文的模型`,
          });
        }
        writer.write({
          type: "data-context-usage",
          id: "context",
          data: {
            estimatedTokens: context.estimatedTokens,
            budgetTokens: config.contextBudgetTokens,
            articleTokens: context.articleTokens,
            compressed: context.compressed,
            retainedMessages: context.retainedMessages,
          },
        } as never);

        if (route.intent === "out-of-scope") {
          const textId = crypto.randomUUID();
          writer.write({ type: "text-start", id: textId } as never);
          writer.write({
            type: "text-delta",
            id: textId,
            delta: route.rationale || OUT_OF_SCOPE_REPLY,
          } as never);
          writer.write({ type: "text-end", id: textId } as never);
          return;
        }

        if (approval) {
          const textId = crypto.randomUUID();
          writer.write({ type: "text-start", id: textId } as never);
          writer.write({
            type: "text-delta",
            id: textId,
            delta:
              "我识别到了本地项目路径。请先选择仅本会话授权，或保存为长期信任项目；授权后会自动继续本次分析。",
          } as never);
          writer.write({ type: "text-end", id: textId } as never);
          return;
        }

        if (route.ambiguityQuestion) {
          const textId = crypto.randomUUID();
          writer.write({ type: "text-start", id: textId } as never);
          writer.write({
            type: "text-delta",
            id: textId,
            delta: route.ambiguityQuestion,
          } as never);
          writer.write({ type: "text-end", id: textId } as never);
          return;
        }

        const agent = await createWritingAgent({
          target: {
            kind: target.kind,
            id: target.id,
            title: loaded.title,
            markdown: articleMarkdown,
            digest: loaded.digest,
            documentType: loaded.documentType,
            snapshotHash: loaded.snapshotHash,
          },
          sessionId: session.id,
          providerId: parsed.data.providerId ?? undefined,
          modelId: parsed.data.modelId ?? undefined,
          project: route.project,
          codeSource,
          config,
          route,
          loadedSkills,
          assetCatalog,
          conversationSummary: context.summary,
          includeArticleBody,
          onCodeExploreStep: async (step) => {
            writer.write({
              type: "data-code-explore-step",
              id: crypto.randomUUID(),
              data: { ...step, status: "completed" },
            } as never);
          },
          onCodeEvidence: async (evidence) => {
            writer.write({
              type: "data-project-snapshot",
              id: crypto.randomUUID(),
              data: {
                projectId: evidence.projectId,
                snapshotHash: evidence.snapshotHash,
                symbols: evidence.symbols.length,
                edges: evidence.edges.length,
                truncated: evidence.truncated,
              },
            } as never);
            for (const source of evidence.entryPoints.slice(0, 12)) {
              writer.write({
                type: "data-source-evidence",
                id: crypto.randomUUID(),
                data: source,
              } as never);
            }
          },
          onChangeEvidence: async (evidence) => {
            writer.write({
              type: "data-git-range",
              id: crypto.randomUUID(),
              data: {
                requestedRange: evidence.requestedRange,
                baseCommit: evidence.baseCommit,
                headCommit: evidence.headCommit,
              },
            } as never);
            for (const commit of evidence.commits.slice(0, 20)) {
              writer.write({
                type: "data-commit-evidence",
                id: commit.sha,
                data: commit,
              } as never);
            }
            writer.write({
              type: "data-change-evidence-summary",
              id: crypto.randomUUID(),
              data: {
                commits: evidence.commits.length,
                changedFiles: evidence.changedFiles.length,
                featureGroups: evidence.featureGroups.length,
                truncated: evidence.truncated,
              },
            } as never);
          },
          onFinishUsage: async (usage) => {
            turnUsage = usage;
            await prisma.agentChatSession.update({
              where: { id: session.id },
              data: {
                lastInputTokens: usage.inputTokens,
                lastOutputTokens: usage.outputTokens,
                lastReasoningTokens: usage.reasoningTokens,
                lastTotalTokens: usage.totalTokens,
              },
            });
          },
          onArticleDigest: async ({ digest }) => {
            // 服务端即时落盘，避免前端 5s 防抖延迟导致 baseVersionHash 与 DB 不一致，
            // 进而使 apply 时 currentHash ≠ baseVersionHash → 409 superseded。
            if (target.kind === "article") {
              await prisma.article.update({
                where: { id: target.id },
                data: { digest },
              });
            }
            writer.write({
              type: "data-article-digest",
              id: crypto.randomUUID(),
              data: { digest },
            } as never);
          },
        });
        const result = await agent.stream({ messages: context.messages });
        writer.merge(
          result.toUIMessageStream({
            sendReasoning: true,
            sendSources: true,
          }) as never
        );
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
    await prisma.$transaction([
      prisma.agentChatMessage.deleteMany({ where: { sessionId: session.id } }),
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
          summary: "",
          summaryUpToPosition: -1,
          selectedProjectId: null,
          providerId: null,
          modelId: null,
          lastInputTokens: 0,
          lastOutputTokens: 0,
          lastReasoningTokens: 0,
          lastTotalTokens: 0,
        },
      }),
      prisma.codeSourceGrant.deleteMany({ where: { sessionId: session.id } }),
    ]);
  }
  return NextResponse.json({ ok: true });
}
