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
  saveAgentMessages,
  type AgentTarget,
} from "@/lib/ai/chat-persistence";
import { createWritingAgent } from "@/lib/ai/writing-agent";
import { getModel } from "@/lib/ai/provider";
import { listSkills, loadSkill } from "@/lib/ai/skills";
import { routeAgentRequest } from "@/lib/ai/agent-orchestrator";
import { prepareAgentContext } from "@/lib/ai/context-manager";
import { parseTags } from "@/lib/asset";
import {
  codeSourceProject,
  createOrReuseCodeSourceGrant,
  type CodeSourceReference,
} from "@/lib/ai/code-source";

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

function errorMessage(error: unknown) {
  // 解包 AI_RetryError：取 lastError 的底层信息再归类
  let raw =
    error instanceof Error
      ? error.message
      : "写作助手执行失败，请稍后重试。";
  const retryErr = error as {
    name?: string;
    lastError?: { message?: string } | Error;
    errors?: Array<{ message?: string } | Error>;
    cause?: { message?: string };
  };
  if (retryErr?.name === "AI_RetryError" || /RetryError/i.test(raw)) {
    const inner =
      (retryErr.lastError instanceof Error
        ? retryErr.lastError.message
        : retryErr.lastError?.message) ??
      retryErr.errors?.find((e) => e)?.message ??
      retryErr.cause?.message ??
      raw;
    raw = inner || raw;
  }

  // 余额不足 / 额度耗尽（智谱 1113、各厂商 402/429、quota 等）
  if (
    /余额不足|额度|配额|insufficient|quota|payment required|exceeded your current quota/i.test(
      raw
    )
  ) {
    return "模型余额不足或额度已用尽，请充值或在「设置 → 系统配置 → AI 模型」中切换供应商/模型。";
  }
  // 认证失败
  if (/401|unauthorized|invalid api key|invalid_api_key|forbidden/i.test(raw)) {
    return "API Key 无效或已过期，请检查「设置 → 系统配置 → AI 模型」中的配置。";
  }
  // 模型不存在 / 不支持
  if (
    /model.*not found|does not exist|未知模型|model_not_found/i.test(raw)
  ) {
    return "所选模型不存在或当前供应商未提供，请在「设置」中更换模型。";
  }
  // 工具调用不支持
  if (
    /tool.?call|function.?call|tools?.+(unsupported|not supported)|不支持.+工具/i.test(
      raw
    )
  ) {
    return "当前模型不支持 Agent 所需的工具调用，请切换到支持 Tool Calling 的模型。";
  }
  // 超时
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET/i.test(raw)) {
    return "请求超时，请检查网络后重试。";
  }
  // 速率限制（非余额类）
  if (/rate limit|too many requests|429/i.test(raw)) {
    return "请求过于频繁被限流，请稍后再试。";
  }
  return raw;
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

export async function GET(req: NextRequest) {
  const target = targetFromQuery(req);
  if (!target) {
    return NextResponse.json({ error: "缺少对话目标。" }, { status: 400 });
  }
  const loaded = await loadTarget(target);
  if (!loaded) return NextResponse.json({ error: "目标不存在。" }, { status: 404 });
  const session = await getOrCreateAgentSession(target);
  const messages = await loadAgentMessages(session.id);
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
  return NextResponse.json({
    session,
    messages,
    proposals: proposals.map((proposal) => ({
      ...proposal,
      proposalKind: target.kind,
    })),
  });
}

export async function POST(req: NextRequest) {
  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Agent 请求参数无效。" }, { status: 400 });
  }
  const target = normalizeTarget(parsed.data);
  const loaded = await loadTarget(target);
  if (!loaded) return NextResponse.json({ error: "目标不存在。" }, { status: 404 });

  const uiMessages = parsed.data.messages as UIMessage[];
  const session = await getOrCreateAgentSession(target);
  const config = await getAgentConfig();
  await saveAgentMessages(session.id, uiMessages);

  try {
    const { model } = await getModel(parsed.data.providerId, parsed.data.modelId);
    const skills = await listSkills();
    const route = await routeAgentRequest({
      model,
      message: lastUserText(uiMessages),
      skills,
      config,
      previousProjectId: session.selectedProjectId,
      targetKind: target.kind,
    });
    let codeSource: CodeSourceReference | undefined;
    let approval:
      | {
          id: string;
          displayName: string;
          locator: string;
          approvalToken: string;
        }
      | undefined;

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
    const assets =
      target.kind === "article" && route.needsAssets
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

    const context = await prepareAgentContext({
      model,
      sessionId: session.id,
      sessionSummary: session.summary,
      summaryUpToPosition: session.summaryUpToPosition,
      uiMessages,
      articleText: `${loaded.title}\n${loaded.digest ?? loaded.documentType ?? ""}\n${loaded.markdown}`,
      contextBudgetTokens: config.contextBudgetTokens,
    });

    let turnUsage:
      | {
          inputTokens: number;
          outputTokens: number;
          reasoningTokens: number;
          totalTokens: number;
        }
      | undefined;
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: uiMessages,
      onFinish: async ({ messages }) => {
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
        await saveAgentMessages(session.id, persisted);
      },
      onError: errorMessage,
      execute: async ({ writer }) => {
        writeStep(writer, {
          id: "intent",
          kind: "intent",
          title: "识别任务意图",
          detail: `${route.intent} · ${route.rationale}`,
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
            detail: route.needsAssets
              ? `已注入 ${assetCatalog.length} 项素材`
              : "本轮无需扫描素材",
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
            markdown: loaded.markdown,
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
          onArticleDraft: async (draft) => {
            writer.write({
              type: "data-article-draft",
              id: crypto.randomUUID(),
              data: { markdown: draft.markdown, title: draft.title ?? null },
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
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

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
      target.kind === "article"
        ? prisma.agentArticleProposal.updateMany({
            where: { sessionId: session.id, status: "pending" },
            data: { status: "rejected", decidedAt: new Date() },
          })
        : prisma.agentTechnicalDocumentProposal.updateMany({
            where: { sessionId: session.id, status: "pending" },
            data: { status: "rejected", decidedAt: new Date() },
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
