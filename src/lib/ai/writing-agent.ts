import { tool, ToolLoopAgent, stepCountIs } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getModel } from "@/lib/ai/provider";
import type { AgentConfig, AgentProjectConfig } from "@/lib/ai/agent-config";
import { listSkills, loadSkill, readSkillResource } from "@/lib/ai/skills";
import { assertSafePublicUrl } from "@/lib/ai/safe-web";
import { articleVersionHash } from "@/lib/ai/article-version";
import { parseTags } from "@/lib/asset";
import type { AgentRoute } from "@/lib/ai/agent-orchestrator";
import { exploreProjectWithAgent } from "@/lib/ai/code-explorer-agent";
import type { CodeEvidencePackage } from "@/lib/ai/code-evidence";
import type { CodeSourceReference } from "@/lib/ai/code-source";
import { fetchGithubPullRequest } from "@/lib/ai/code-source";
import {
  analyzeCodeChangesWithAgent,
  type CodeChangeEvidencePackage,
} from "@/lib/ai/git-analysis";
import { moduleLogger } from "@/lib/logger";
import { extractArticleOutline } from "@/lib/ai/current-article";

const log = moduleLogger("ai.agent");

/**
 * 包装工具 execute：统一记录工具名、入参摘要、耗时与成功/失败。
 * 仅记录结构化字段，不记录完整正文（markdown 等大对象只记长度）。
 */
function withToolLog<TArgs extends Record<string, unknown>, TResult>(
  name: string,
  execute: (args: TArgs) => Promise<TResult>
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs) => {
    const start = Date.now();
    const summary = summarizeToolArgs(name, args);
    log.debug({ tool: name, args: summary }, `工具调用 ${name}`);
    try {
      const result = await execute(args);
      const durationMs = Date.now() - start;
      log.info({ tool: name, durationMs }, `工具完成 ${name}`);
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      log.error({ tool: name, durationMs, err }, `工具失败 ${name}`);
      throw err;
    }
  };
}

/** 工具入参摘要：大文本只记长度，避免日志爆炸 */
function summarizeToolArgs(
  name: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.length > 80) {
      out[key] = `${value.slice(0, 80)}…(${value.length} chars)`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

type AgentTargetContext = {
  kind: "article" | "technical-document";
  id: string;
  title: string;
  markdown: string;
  digest?: string;
  documentType?: string;
  snapshotHash?: string;
};

async function tavilyRequest(
  config: AgentConfig,
  endpoint: "search" | "extract",
  body: Record<string, unknown>
) {
  if (!config.tavilyApiKey) throw new Error("未配置 Tavily API Key。");
  const response = await fetch(`https://api.tavily.com/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${config.tavilyApiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof (data as { detail?: unknown }).detail === "string"
        ? (data as { detail: string }).detail
        : `Tavily 请求失败（${response.status}）。`
    );
  }
  return data;
}

/** 省略全文时的轻量正文概要：标题 + 摘要 + 篇幅 + 大纲（让模型知道文章存在与结构，但不耗全文 token）。 */
function articleDescriptor(target: AgentTargetContext): string {
  const outline = extractArticleOutline(target.markdown ?? "");
  const outlineText = outline.length
    ? outline.map((h) => `    ${h}`).join("\n")
    : "    （无标题）";
  return [
    "（本轮按需未载入全文，仅概要）",
    `  - 标题：${target.title || "（未填写）"}`,
    `  - 摘要：${target.digest || target.documentType || "（未填写）"}`,
    `  - 篇幅：约 ${(target.markdown ?? "").length.toLocaleString()} 字`,
    `  - 大纲：`,
    outlineText,
  ].join("\n");
}

export async function createWritingAgent(input: {
  target: AgentTargetContext;
  sessionId: string;
  providerId?: string;
  modelId?: string;
  project?: AgentProjectConfig;
  codeSource?: CodeSourceReference;
  config: AgentConfig;
  route: AgentRoute;
  loadedSkills: Array<{
    id: string;
    name: string;
    description: string;
    manual: string;
    resources: string[];
  }>;
  assetCatalog: Array<{
    id: string;
    name: string;
    url: string;
    kind: string;
    description: string;
    tags: string[];
  }>;
  conversationSummary?: string;
  /** 是否把文章全文注入系统提示。默认 true；与正文无关的任务（联网/代码）可省略只带摘要，省 token。 */
  includeArticleBody?: boolean;
  onFinishUsage?: (usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  }) => Promise<void> | void;
  onCodeExploreStep?: (step: {
    title: string;
    detail: string;
  }) => Promise<void> | void;
  onCodeEvidence?: (evidence: CodeEvidencePackage) => Promise<void> | void;
  onChangeEvidence?: (
    evidence: CodeChangeEvidencePackage
  ) => Promise<void> | void;
  /** 摘要生成时，把短摘要镜像到编辑器（复用编辑器 digest 自动保存链路落盘）。 */
  onArticleDigest?: (input: { digest: string }) => Promise<void> | void;
}) {
  const { model, config: modelConfig } = await getModel(
    input.providerId,
    input.modelId
  );
  const skillCatalog = await listSkills();
  // baseHash/currentDigest 为可变变量：set_article_digest 在同一 agent 执行期间会更新 digest，
  // 必须同步重算 hash，否则后续 propose_*_revision 写入的 baseVersionHash 会与前端自动保存后的 DB 状态不匹配，
  // 导致 apply 时 409 superseded。
  let baseHash = articleVersionHash({
    title: input.target.title,
    markdown: input.target.markdown,
    digest: input.target.digest ?? input.target.snapshotHash ?? "",
  });
  let currentDigest = input.target.digest ?? input.target.snapshotHash ?? "";
  const tools = {
    set_task_plan: tool({
      title: "制定写作计划",
      description: "在复杂任务开始时，声明用户意图、执行步骤和预期交付物。",
      inputSchema: z.object({
        intent: z.string().min(1),
        steps: z.array(z.string().min(1)).min(1).max(8),
        deliverable: z.string().min(1),
      }),
      execute: async (plan) => ({ ok: true, ...plan }),
    }),
    load_skill: tool({
      title: "加载写作 Skill",
      description: `按需加载完整 Skill 手册。可用 Skill：${skillCatalog
        .map((skill) => `${skill.id}（${skill.description}）`)
        .join("；")}`,
      inputSchema: z.object({ id: z.string().min(1) }),
      execute: withToolLog("load_skill", async ({ id }) => loadSkill(id)),
    }),
    read_skill_resource: tool({
      title: "读取 Skill 资源",
      description: "仅在已加载 Skill 声明了 resources 时读取其中一个资源。",
      inputSchema: z.object({
        id: z.string().min(1),
        path: z.string().min(1),
      }),
      execute: withToolLog("read_skill_resource", async ({ id, path }) =>
        readSkillResource(id, path)
      ),
    }),
    web_search: tool({
      title: "搜索网络资料",
      description: "搜索最新资料、事实、数据和权威来源。返回标题、摘要和 URL。",
      inputSchema: z.object({
        query: z.string().min(2),
        topic: z.enum(["general", "news", "finance"]).default("general"),
        maxResults: z.number().int().min(1).max(10).default(5),
      }),
      execute: withToolLog("web_search", async ({ query, topic, maxResults }) =>
        tavilyRequest(input.config, "search", {
          query,
          topic,
          max_results: maxResults,
          include_answer: false,
          include_raw_content: false,
        })
      ),
    }),
    web_extract: tool({
      title: "读取网页正文",
      description: "读取已知公共网页的正文。优先读取搜索结果中的高价值来源。",
      inputSchema: z.object({ url: z.string().url() }),
      execute: withToolLog("web_extract", async ({ url }) => {
        const safeUrl = await assertSafePublicUrl(url);
        return tavilyRequest(input.config, "extract", {
          urls: [safeUrl],
          format: "markdown",
          extract_depth: "basic",
        });
      }),
    }),
    explore_project: tool({
      title: "只读探索代码项目",
      description: input.project
        ? `委托独立只读 Code Explorer 分析“${input.project.name}”，返回带文件和行号的结构化证据包。`
        : "当前没有已授权代码源，调用会失败。",
      inputSchema: z.object({
        objective: z.string().min(3).max(1000),
      }),
      execute: withToolLog("explore_project", async ({ objective }) => {
        if (!input.project) throw new Error("当前没有已授权代码源。");
        const result = await exploreProjectWithAgent({
          model,
          project: input.project,
          objective,
          maxSteps: Math.min(12, input.config.maxSteps),
          onStep: input.onCodeExploreStep,
        });
        await input.onCodeEvidence?.(result);
        return result;
      }),
    }),
    analyze_code_changes: tool({
      title: "分析 Git 提交与代码差异",
      description: input.project
        ? `只读分析“${input.project.name}”的固定提交范围、Diff 和相关源码，返回可追溯的功能变更证据包。`
        : "当前没有已授权代码源，调用会失败。",
      inputSchema: z.object({
        objective: z.string().min(3).max(1000),
        requestedRange: z.string().optional(),
        base: z.string().optional(),
        head: z.string().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
      }),
      execute: withToolLog("analyze_code_changes", async ({ objective, ...range }) => {
        if (!input.project || !input.codeSource) {
          throw new Error("当前没有已授权代码源。");
        }
        const result = await analyzeCodeChangesWithAgent({
          model,
          project: input.project,
          source: input.codeSource,
          objective,
          range,
          maxSteps: Math.min(10, input.config.maxSteps),
          onStep: input.onCodeExploreStep,
        });
        await input.onChangeEvidence?.(result);
        return {
          source: result.source,
          baseCommit: result.baseCommit,
          headCommit: result.headCommit,
          requestedRange: result.requestedRange,
          commits: result.commits,
          changedFiles: result.changedFiles,
          featureGroups: result.featureGroups,
          risks: result.risks,
          openQuestions: result.openQuestions,
          truncated: result.truncated,
        };
      }),
    }),
    github_pull_request: tool({
      title: "读取 GitHub Pull Request",
      description:
        input.codeSource?.kind === "github"
          ? "读取当前 GitHub 公开仓库的 PR 元数据、提交和文件变化。"
          : "当前代码源不是 GitHub 仓库，调用会失败。",
      inputSchema: z.object({
        pullNumber: z.number().int().positive(),
      }),
      execute: withToolLog("github_pull_request", async ({ pullNumber }) => {
        if (
          input.codeSource?.kind !== "github" ||
          !input.codeSource.owner ||
          !input.codeSource.repo
        ) {
          throw new Error("当前代码源不是 GitHub 仓库。");
        }
        return fetchGithubPullRequest({
          owner: input.codeSource.owner,
          repo: input.codeSource.repo,
          pullNumber,
          config: input.config,
        });
      }),
    }),
    article_assets: tool({
      title: "读取文章素材",
      description:
        "查看当前文章已上传的图片、视频和文件素材，含每张素材的描述与标签。创作、重写或扩充文章时应优先调用，按素材描述/标签的相关性决定是否插图及插入位置。",
      inputSchema: z.object({}),
      execute: withToolLog("article_assets", async () => {
        const assets = await prisma.asset.findMany({
          where: { articleId: input.target.id, trashed: false },
          select: {
            id: true,
            name: true,
            url: true,
            kind: true,
            contentType: true,
            description: true,
            tagsJson: true,
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return {
          assets: assets.map((a) => ({
            id: a.id,
            name: a.name,
            url: a.url,
            kind: a.kind,
            contentType: a.contentType,
            description: a.description,
            tags: parseTags(a.tagsJson),
          })),
        };
      }),
    }),
    set_article_digest: tool({
      title: "更新文章摘要",
      description:
        "为当前文章生成或更新一句话短摘要（≤120 字），写回文章摘要字段并同步到编辑器。用于「总结/概括/生成摘要」类请求；要点清单、TL;DR 等较长形态作为对话文本展示，不要调用本工具。",
      inputSchema: z.object({
        digest: z.string().min(1).max(200),
      }),
      execute: withToolLog("set_article_digest", async ({ digest }) => {
        if (input.target.kind !== "article") {
          throw new Error("当前目标不是公众号文章。");
        }
        // 对齐 /api/ai/digest 的 ≤120 字约束
        const trimmed = digest.trim().slice(0, 120);
        currentDigest = trimmed;
        // 同步重算 baseHash，使后续 propose_article_revision 写入的 baseVersionHash
        // 与服务端即时落盘后的 DB 状态保持一致，避免 apply 时 409 superseded。
        baseHash = articleVersionHash({
          title: input.target.title,
          markdown: input.target.markdown,
          digest: currentDigest,
        });
        await input.onArticleDigest?.({ digest: trimmed });
        return { ok: true, digest: trimmed };
      }),
    }),
    propose_article_revision: tool({
      title: "提交文章修改提案",
      description:
        "当用户要求创建或修改文章时调用。提交完整 Markdown 快照供用户审阅。首次生成（编辑器为空）会直接写入，后续修改需用户 diff 审查后应用。",
      inputSchema: z.object({
        title: z.string().max(200).optional(),
        markdown: z.string().min(1),
        digest: z.string().max(200).optional(),
        summary: z.string().min(1).max(500),
      }),
      execute: withToolLog(
        "propose_article_revision",
        async ({ title, markdown, digest, summary }) => {
          if (input.target.kind !== "article") {
            throw new Error("当前目标不是公众号文章。");
          }
          // 首次生成（编辑器为空，无对比源）：跳过提案创建，前端直接写入编辑器
          const isEmptyArticle = input.target.markdown.trim() === "";
          if (isEmptyArticle) {
            return {
              mode: "direct" as const,
              markdown,
              title: title ?? null,
              digest: digest ?? null,
              summary,
            };
          }

          // 后续修改：创建提案，供前端 diff 审查后应用
          const oldLines = input.target.markdown.split("\n");
          const newLines = markdown.split("\n");
          const changedLines = Math.max(oldLines.length, newLines.length);
          const proposal = await prisma.agentArticleProposal.create({
            data: {
              articleId: input.target.id,
              sessionId: input.sessionId,
              baseVersionHash: baseHash,
              baseTitle: input.target.title,
              baseMarkdown: input.target.markdown,
              baseDigest: currentDigest,
              title: title ?? null,
              markdown,
              digest: digest ?? null,
              summary,
            },
          });
          return {
            mode: "proposal" as const,
            proposalId: proposal.id,
            status: proposal.status,
            summary: proposal.summary,
            title: proposal.title,
            stats: {
              oldLines: oldLines.length,
              newLines: newLines.length,
              changedLines,
            },
          };
        }
      ),
    }),
    propose_technical_document_revision: tool({
      title: "提交技术文档提案",
      description:
        "当用户要求创建或修改技术文档时调用。提交完整 Markdown、项目快照和来源证据供审阅。",
      inputSchema: z.object({
        title: z.string().max(200).optional(),
        markdown: z.string().min(1),
        snapshotHash: z.string().optional(),
        sourceSnapshot: z.record(z.string(), z.unknown()).optional(),
        summary: z.string().min(1).max(500),
      }),
      execute: withToolLog(
        "propose_technical_document_revision",
        async ({
          title,
          markdown,
          snapshotHash,
          sourceSnapshot,
          summary,
        }) => {
          if (input.target.kind !== "technical-document") {
            throw new Error("当前目标不是技术文档。");
          }
          const oldLines = input.target.markdown.split("\n");
          const newLines = markdown.split("\n");
          const proposal = await prisma.agentTechnicalDocumentProposal.create({
            data: {
              technicalDocumentId: input.target.id,
              sessionId: input.sessionId,
              baseVersionHash: baseHash,
              baseTitle: input.target.title,
              baseMarkdown: input.target.markdown,
              baseSnapshotHash: input.target.snapshotHash ?? "",
              title: title ?? null,
              markdown,
              snapshotHash: snapshotHash ?? input.target.snapshotHash ?? null,
              sourceSnapshotJson: JSON.stringify({
                ...(sourceSnapshot ?? {}),
                ...(input.codeSource ? { codeSource: input.codeSource } : {}),
              }),
              summary,
            },
          });
          return {
            proposalId: proposal.id,
            proposalKind: "technical-document",
            status: proposal.status,
            summary: proposal.summary,
            stats: {
              oldLines: oldLines.length,
              newLines: newLines.length,
              changedLines: Math.max(oldLines.length, newLines.length),
            },
          };
        }
      ),
    }),
  };

  const loadedSkillText = input.loadedSkills.length
    ? input.loadedSkills
        .map(
          (skill) => `## 已加载 Skill：${skill.name}
${skill.description}

${skill.manual}

可读取资源：${skill.resources.join("、") || "无"}`
        )
        .join("\n\n")
    : "（本轮没有预加载 Skill）";
  const assetText =
    input.target.kind === "article" && input.assetCatalog.length
    ? input.assetCatalog
        .map(
          (asset) =>
            `- ${asset.name} | ${asset.kind} | ${asset.url} | 描述：${asset.description || "无"} | 标签：${asset.tags.join("、") || "无"}`
        )
        .join("\n")
    : "（当前文章没有可用素材）";

  const instructions = `你是 InkPress 的专业公众号写作 Agent。

工作规则：
1. 服务端已完成意图识别和 Skill 预加载。复杂任务先调用 set_task_plan；只有发现遗漏能力时才补充调用 load_skill。
2. 研究类任务必须先调用工具获取事实；分析源码时调用 explore_project；分析 Commit、版本、PR 或 Diff 时先调用 analyze_code_changes 获取独立只读证据包。
3. 清楚区分事实、来源和推断。联网信息在最终回答中保留来源 URL。
4. **关键**：当前目标为文章时，凡是产出或修改正文（创作、扩写、重写、润色、补充段落），都必须调用 propose_article_revision 提交完整 Markdown，**绝不把正文直接输出为对话文本**——正文只有通过该工具才能落到编辑器。当前目标为技术文档时同理必须调用 propose_technical_document_revision。
4b. **摘要**：当意图为 summarize（总结/摘要/要点/TL;DR）时，必须调用 set_article_digest 提交一句话短摘要（≤120 字）写回摘要字段；要点清单、TL;DR 作为对话文本展示，不要塞进 digest。summarize 意图不得调用 propose_article_revision（不创建或修改正文）。
5. **素材使用**：公众号文章创作、重写或扩充时，若素材列表非空，必须按素材描述/标签的相关性在合适位置插图，使用 \`![简短图注](素材URL)\` 语法，URL 必须取自素材列表，不得编造。无关素材不硬塞。技术文档不调用文章素材工具。
6. 不输出隐藏思维链，只提供简洁计划、执行结果、来源和可操作结论。
7. 避免无意义重复工具调用；工具失败时最多调整方案重试一次。

当前目标：${input.target.kind === "article" ? "公众号文章" : "技术文档"}
- 标题：${input.target.title || "（未填写）"}
- 摘要/类型：${input.target.digest || input.target.documentType || "（未填写）"}
- 项目快照：${input.target.snapshotHash || "（无）"}
- 正文：
${
  input.includeArticleBody === false
    ? `${articleDescriptor(input.target)}\n（本轮任务与现有正文无直接关系，已按需省略全文，仅保留上方概要；若用户其实想操作当前文章，请提示其明确指代「当前文章」，下一轮会自动载入全文。）`
    : `${input.target.markdown || "（空内容）"}\n\n（上方「正文」即用户当前正在编辑的文章/文档。规则：\n- 用户说的「当前文章/本文/这篇/当前编辑区/当前文档」一律指上方正文，直接基于它处理；\n- 若用户指代某个标题/章节下方的段落（如「第三节」「X 标题下方」），从上方正文中定位对应章节后再操作；\n- 正文非空时禁止反问用户索要正文或文件路径；\n- 若正文显示「（空内容）」，说明当前文章为空，应直接告知用户先在编辑器写入内容或粘贴正文，不要臆造内容。）`
}

当前代码源：${input.codeSource ? `${input.codeSource.displayName} | ${input.codeSource.kind} | ${input.codeSource.locator}` : input.project ? `${input.project.name}（只读）` : "未选择"}
本轮意图：${input.route.intent}
路由说明：${input.route.rationale}

对话历史摘要：
${input.conversationSummary || "（无）"}

已加载 Skill：
${loadedSkillText}

当前文章素材目录：
${assetText}

（可按需加载的完整 Skill 目录见 load_skill 工具说明，此处不再重复。）`;

  log.info(
    {
      sessionId: input.sessionId,
      target: input.target.id,
      targetKind: input.target.kind,
      intent: input.route.intent,
      activeTools: input.route.activeTools,
      skills: input.route.skillIds,
      hasProject: !!input.project,
      hasCodeSource: !!input.codeSource,
    },
    "写作 Agent 已创建"
  );

  return new ToolLoopAgent({
    id: "inkpress-writing-agent",
    model,
    instructions,
    tools,
    activeTools: input.route.activeTools as Array<keyof typeof tools>,
    temperature: modelConfig?.temperature ?? 0.6,
    // 限制重试次数：余额不足等致命错误重试无意义，默认 2 次改为 1 次以更快暴露
    maxRetries: 1,
    stopWhen: stepCountIs(input.config.maxSteps),
    onFinish: async (event) => {
      const usage = event.totalUsage;
      const totalTokens = usage.totalTokens ?? 0;
      log.info(
        {
          sessionId: input.sessionId,
          target: input.target.id,
          totalTokens,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
        },
        "写作 Agent 轮次完成"
      );
      await input.onFinishUsage?.({
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
        totalTokens,
      });
    },
  });
}
