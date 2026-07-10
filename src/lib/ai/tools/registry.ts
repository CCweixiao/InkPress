import { z } from "zod";
import { prisma } from "@/lib/db";
import { loadSkill, readSkillResource, type SkillCatalogItem } from "@/lib/ai/skills";
import { parseTags } from "@/lib/asset";
import { articleVersionHash } from "@/lib/ai/article-version";
import { fetchGithubPullRequest, type CodeSourceReference } from "@/lib/ai/code-source";
import type { PermissionDecision } from "@/lib/ai/permission-engine";
import {
  listProjectFiles,
  readProjectFile,
  searchProject,
} from "@/lib/ai/project-access";
import { getProjectIndex, getProjectSnapshotHash } from "@/lib/ai/project-index";
import {
  readGitDiffSummary,
  readGitLog,
  resolveGitRange,
  type GitRangeInput,
} from "@/lib/ai/git-analysis";
import type { AgentConfig, AgentProjectConfig } from "@/lib/ai/agent-config";
import type { WebResearchConfig } from "@/lib/ai/web-research-config";
import type {
  ToolCategory,
  ToolDisplay,
  ToolDisplayContext,
  ToolDisplayFactory,
  ToolDisplayPhase,
} from "@/lib/ai/agent-runtime-events";
import { searchWithTavily, fetchWebPage } from "@/lib/ai/tools/web-research";
import { ARTICLE_BODY_BUDGET } from "@/lib/ai/system-prompt";

/**
 * InkPress MCP 工具的声明式注册表（单一事实源）。
 *
 * 新增工具只需在此追加一条 InkPressToolDefinition；createInkPressMcpServer 遍历它
 * 通过 SDK tool() 注册为 mcp__inkpress__<name>。前端的中文 label 已在
 * src/components/ai/tool-helpers.tsx 的 TOOL_REGISTRY（按裸名匹配），无需在此重复。
 *
 * 工具 execute 返回 InkPress 业务对象；MCP server 会把业务对象直接写入 UI 工具卡片。
 * 给模型的 tool_result 默认同时包含 text content 和 structuredContent；少数兼容端点
 * 对 structuredContent 支持不稳时，可用 `modelResultMode: "text-only"` 只给模型纯文本。
 */

/** MCP 工具执行时拿到的 InkPress 上下文（每次 query 前由 runtime 组装）。 */
export type InkPressToolContext = {
  target: {
    kind: "article" | "technical-document";
    id: string;
    title: string;
    markdown: string;
    digest?: string;
    documentType?: string;
    snapshotHash?: string;
  };
  sessionId: string;
  /** 仅 propose_technical_document_revision 的 sourceSnapshotJson 用。 */
  codeSource?: CodeSourceReference;
  /** github_pull_request 取 githubToken 用（buildClaudeAgentOptions 经 getAgentConfig 解析）。 */
  agentConfig?: AgentConfig;
  /** P2.5 联网搜索配置（tavilyApiKey + autoApprove）。web_search 守门用。 */
  webResearch: WebResearchConfig;
  /** load_skill 的 description / system prompt 摘要用。 */
  skillCatalog: SkillCatalogItem[];
  /** 本轮 read_current_article 已读取的正文范围，用于长文完整替换提案守门。 */
  currentArticleReadState?: {
    contentRevision: string;
    ranges: Array<{ start: number; end: number }>;
  };
  /**
   * 向 UI 流写 UIMessage chunk（与 writer.write 同源）。MCP handler 在进程内执行时
   * 直接用它发 tool-input-available / tool-output-available 等 chunk，渲染工具卡片，
   * 无需依赖 SDK 是否把 tool_result 回流到消费流。
   */
  emit: (part: never) => void;
};

export type InkPressToolDefinition = {
  /** 裸名（如 load_skill）。模型看到的是 mcp__inkpress__<name>。 */
  name: string;
  description: string | ((ctx: InkPressToolContext) => string);
  /** Zod 4 raw shape，作为 SDK tool() 的 inputSchema。 */
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /** 权限决策：allow（自动批准）/ ask（执行前弹审批卡）/ deny（禁用）。见 permission-engine。 */
  permission: PermissionDecision;
  /** 产品能力分类（单一事实源，前端分组/图标可消费）。 */
  category: ToolCategory;
  /** 工具语义版本（未来兼容性判断用）。 */
  version: string;
  /** 后端生成展示语义（title/activityKind/summary），前端 ToolCallBlock 通用渲染消费。 */
  display: ToolDisplayFactory;
  /** 输出结构声明（P1 仅声明，不做运行时校验）。 */
  outputSchema?: Record<string, z.ZodTypeAny>;
  /** 可选：把 execute 结果转成给模型的 content[0].text（默认 JSON.stringify）。
   * web_fetch 等返回大文本的工具应提供，避免 JSON 信封让模型（尤其 GLM）难以消费。 */
  toContentText?: (result: unknown) => string;
  /**
   * 控制返回给模型的 MCP CallToolResult 形态。UI 工具卡片始终使用 execute 的原始对象；
   * 这里仅影响 SDK 回流给模型的 tool_result。
   */
  modelResultMode?: "text-and-structured" | "text-only";
  execute: (
    ctx: InkPressToolContext,
    args: Record<string, unknown>
  ) => Promise<unknown>;
};

/** 提案 baseVersionHash：用本次 target 快照算（P1 不接 set_article_digest，一次 query 内稳定）。 */
const baseVersionHashOf = (ctx: InkPressToolContext) =>
  articleVersionHash({
    title: ctx.target.title,
    markdown: ctx.target.markdown,
    digest: ctx.target.digest ?? ctx.target.snapshotHash ?? "",
  });

// ────────────────────────────────────────────────────────────────────────────
// P1 display factory（后端生成展示语义）。前端 ToolCallBlock 优先消费 part.toolMetadata.display，
// 回退到 tool-helpers.tsx 的 TOOL_REGISTRY。语义对齐前端原 label/summarize。
// factory 只依赖 phase/args/output/error，不依赖 ctx（保持纯展示）。
// ────────────────────────────────────────────────────────────────────────────

const argOf = (v: unknown) =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const outOf = (v: unknown) =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

const loadSkillDisplay: ToolDisplayFactory = ({ phase, args, output }) => {
  const a = argOf(args);
  const o = outOf(output);
  const id = String(a.id ?? "");
  const name = phase === "completed" ? String(o.name ?? o.id ?? id) : id;
  return {
    title: "补充加载 Skill",
    activityKind: "skill",
    summary:
      phase === "failed"
        ? undefined
        : phase === "completed"
          ? `已加载 ${name}`
          : `正在加载 ${id}`,
  };
};

const readSkillResourceDisplay: ToolDisplayFactory = ({ phase }) => ({
  title: "读取 Skill 资源",
  activityKind: "skill",
  summary:
    phase === "failed" ? undefined : phase === "completed" ? "已读取资源" : "正在读取资源",
});

const articleAssetsDisplay: ToolDisplayFactory = ({ phase, output }) => {
  const o = outOf(output);
  return {
    title: "筛选文章素材",
    activityKind: "read",
    summary:
      phase === "completed"
        ? `读取 ${Array.isArray(o.assets) ? o.assets.length : 0} 项素材`
        : phase === "failed"
          ? undefined
          : "正在读取素材",
  };
};

const loadSnippetsDisplay: ToolDisplayFactory = ({ phase, output }) => {
  const o = outOf(output);
  return {
    title: "加载灵感素材",
    activityKind: "read",
    summary:
      phase === "completed"
        ? `已加载 ${Array.isArray(o) ? o.length : 0} 条灵感`
        : phase === "failed"
          ? undefined
          : "正在加载灵感素材",
  };
};

const setArticleDigestDisplay: ToolDisplayFactory = ({ phase }) => ({
  title: "设置文章摘要",
  activityKind: "write",
  summary:
    phase === "failed" ? undefined : phase === "completed" ? "已写入摘要字段" : "正在写入摘要",
});

const proposeArticleRevisionDisplay: ToolDisplayFactory = ({ phase, output }) => {
  const o = outOf(output);
  return {
    title: "生成文章修改提案",
    activityKind: "proposal",
    summary:
      phase === "failed"
        ? undefined
        : phase === "completed"
          ? o.ok === false
            ? String(o.message ?? "文章修改提案未生成")
            : "文章修改提案已生成"
          : "正在生成文章修改提案",
  };
};

const readCurrentArticleDisplay: ToolDisplayFactory = ({ phase, args, output, error }) => {
  const a = argOf(args);
  const o = outOf(output);
  return {
    title: "读取当前文章正文",
    activityKind: "read",
    summary:
      phase === "failed"
        ? error
        : phase === "completed"
          ? `已读取 ${Number(o.start ?? 0)}-${Number(o.end ?? 0)} / ${Number(o.totalCharacters ?? 0)}`
          : `正在读取 ${Number(a.start ?? 0)}-${Number(a.end ?? 0)}`,
  };
};

const proposeTechnicalDocumentRevisionDisplay: ToolDisplayFactory = ({ phase }) => ({
  title: "生成技术文档提案",
  activityKind: "proposal",
  summary:
    phase === "failed"
      ? undefined
      : phase === "completed"
        ? "技术文档提案已生成"
        : "正在生成技术文档提案",
});

const projectOverviewDisplay: ToolDisplayFactory = ({ phase, output }) => {
  const o = outOf(output);
  return {
    title: "项目结构概览",
    activityKind: "search",
    summary:
      phase === "completed"
        ? `索引 ${Number(o.files ?? 0)} 文件 · ${Number(o.symbols ?? 0)} 符号 · ${Number(o.edges ?? 0)} 关系`
        : phase === "failed"
          ? undefined
          : "正在构建项目索引",
  };
};

const projectSearchDisplay: ToolDisplayFactory = ({ phase, args, output }) => {
  const a = argOf(args);
  const o = outOf(output);
  return {
    title: "搜索本地代码项目",
    activityKind: "search",
    summary:
      phase === "completed"
        ? `找到 ${Array.isArray(o.matches) ? o.matches.length : 0} 个匹配`
        : phase === "failed"
          ? undefined
          : `搜索 ${String(a.query ?? "")}`.trim(),
  };
};

const projectReadDisplay: ToolDisplayFactory = ({ phase, args, output, error }) => {
  const a = argOf(args);
  const o = outOf(output);
  const path = String(a.path ?? "项目文件");
  return {
    title: "读取项目文件",
    activityKind: "read",
    summary:
      phase === "failed"
        ? error
        : phase === "completed"
          ? `已读取 ${String(o.path ?? path)}`
          : `正在读取 ${path}`,
    metadata: { path },
  };
};

const projectGlobDisplay: ToolDisplayFactory = ({ phase, output }) => {
  const o = outOf(output);
  const total = Number(o.total ?? 0);
  return {
    title: "列出项目文件",
    activityKind: "search",
    summary:
      phase === "completed"
        ? `匹配 ${total || (Array.isArray(o.files) ? o.files.length : 0)} 个文件`
        : phase === "failed"
          ? undefined
          : "正在列出文件",
  };
};

const gitLogDisplay: ToolDisplayFactory = ({ phase, output, error }) => {
  const o = outOf(output);
  return {
    title: "查看提交历史",
    activityKind: "search",
    summary:
      phase === "failed"
        ? error
        : phase === "completed"
          ? `${Number(o.commits ?? 0)} 条提交`
          : "正在读取提交历史",
  };
};

const gitDiffSummaryDisplay: ToolDisplayFactory = ({ phase, output, error }) => {
  const o = outOf(output);
  return {
    title: "查看变更摘要",
    activityKind: "search",
    summary:
      phase === "failed"
        ? error
        : phase === "completed"
          ? `${Array.isArray(o.changedFiles) ? o.changedFiles.length : 0} 个文件变更`
          : "正在读取变更摘要",
  };
};

const githubPullRequestDisplay: ToolDisplayFactory = ({ phase }) => ({
  title: "读取 GitHub Pull Request",
  activityKind: "search",
  summary: phase === "failed" ? undefined : phase === "completed" ? "已读取 PR" : "正在读取 PR",
});

const webSearchDisplay: ToolDisplayFactory = ({ phase, args, output, error }) => {
  const o = outOf(output);
  return {
    title: "搜索网络资料",
    activityKind: "web",
    summary:
      phase === "failed"
        ? error
        : phase === "completed"
          ? `获得 ${Array.isArray(o.results) ? o.results.length : 0} 条结果`
          : `搜索 ${String(argOf(args).query ?? "")}`.trim(),
  };
};

const webFetchDisplay: ToolDisplayFactory = ({ phase, args, output, error }) => {
  const url = String(argOf(args).url ?? "");
  const o = outOf(output);
  return {
    title: "读取网页正文",
    activityKind: "web",
    summary:
      phase === "failed"
        ? error
        : phase === "completed"
          ? `已读取 ${String(o.title ?? url)}`
          : `正在读取 ${url}`,
  };
};

const loadSkillTool: InkPressToolDefinition = {
  name: "load_skill",
  permission: "allow",
  category: "skill",
  version: "1.0.0",
  display: loadSkillDisplay,
  description: (ctx) =>
    `按需加载完整写作 Skill 手册。可用 Skill：${
      ctx.skillCatalog.map((s) => `${s.id}（${s.description}）`).join("；") || "（暂无）"
    }。`,
  inputSchema: { id: z.string().min(1) },
  annotations: { readOnlyHint: true },
  execute: (_ctx, args) => loadSkill(String(args.id ?? "")),
};

const readSkillResourceTool: InkPressToolDefinition = {
  name: "read_skill_resource",
  permission: "allow",
  category: "skill",
  version: "1.0.0",
  display: readSkillResourceDisplay,
  description: "仅在已加载 Skill 声明了 resources 时，读取其中一个资源文件。",
  inputSchema: { id: z.string().min(1), path: z.string().min(1) },
  annotations: { readOnlyHint: true },
  execute: (_ctx, args) =>
    readSkillResource(String(args.id ?? ""), String(args.path ?? "")),
};

const articleAssetsTool: InkPressToolDefinition = {
  name: "article_assets",
  permission: "allow",
  category: "article",
  version: "1.0.0",
  display: articleAssetsDisplay,
  description:
    "查看当前文章已上传的图片、视频和文件素材，含每张素材的描述与标签。创作、重写或扩充文章时应优先调用，按素材描述/标签的相关性决定是否插图及插入位置。",
  inputSchema: {},
  annotations: { readOnlyHint: true },
  execute: async (ctx) => {
    const assets = await prisma.asset.findMany({
      where: { articleId: ctx.target.id, trashed: false },
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
  },
};

const loadSnippetsTool: InkPressToolDefinition = {
  name: "load_snippets",
  permission: "allow",
  category: "memory",
  version: "1.0.0",
  display: loadSnippetsDisplay,
  description:
    "加载灵感素材块的完整内容。当用户消息含 {{snippet:id}} 引用时调用，传入出现的全部 id；返回每条的标题/正文/类型/图片/引用出处/链接/标签，用于自然融入文章。",
  inputSchema: {
    ids: z.array(z.string().min(1)).min(1),
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (_ctx, args) => {
    const ids = Array.isArray(args.ids) ? (args.ids as string[]) : [];
    return prisma.snippet.findMany({
      where: { id: { in: ids }, trashed: false },
      select: {
        id: true,
        title: true,
        content: true,
        kind: true,
        imageUrl: true,
        quoteSource: true,
        linkUrl: true,
        linkTitle: true,
        tagsJson: true,
      },
    });
  },
};

function mergeRanges(ranges: Array<{ start: number; end: number }>) {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) {
      merged.push({ ...range });
      continue;
    }
    last.end = Math.max(last.end, range.end);
  }
  return merged;
}

function rangesCover(
  ranges: Array<{ start: number; end: number }>,
  start: number,
  end: number
) {
  if (end <= start) return true;
  let cursor = start;
  for (const range of mergeRanges(ranges)) {
    if (range.end <= cursor) continue;
    if (range.start > cursor) return false;
    cursor = Math.max(cursor, range.end);
    if (cursor >= end) return true;
  }
  return false;
}

const readCurrentArticleTool: InkPressToolDefinition = {
  name: "read_current_article",
  permission: "allow",
  category: "article",
  version: "1.0.0",
  display: readCurrentArticleDisplay,
  description:
    "按字符范围读取当前文章完整正文。正文在系统提示中被截断时，先用 start/end 分段读取并覆盖全文，再提交完整 Markdown 提案。",
  inputSchema: {
    start: z.number().int().min(0),
    end: z.number().int().min(1),
  },
  outputSchema: {
    markdown: z.string(),
    start: z.number().int(),
    end: z.number().int(),
    totalCharacters: z.number().int(),
    contentRevision: z.string(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (ctx, args) => {
    if (ctx.target.kind !== "article") throw new Error("当前目标不是公众号文章。");
    const totalCharacters = ctx.target.markdown.length;
    const requestedStart = typeof args.start === "number" ? args.start : 0;
    const requestedEnd = typeof args.end === "number" ? args.end : totalCharacters;
    const start = Math.min(Math.max(0, requestedStart), totalCharacters);
    const end = Math.min(Math.max(start, requestedEnd), totalCharacters);
    const contentRevision = baseVersionHashOf(ctx);
    if (ctx.currentArticleReadState?.contentRevision !== contentRevision) {
      ctx.currentArticleReadState = { contentRevision, ranges: [] };
    }
    ctx.currentArticleReadState.ranges.push({ start, end });
    return {
      markdown: ctx.target.markdown.slice(start, end),
      start,
      end,
      totalCharacters,
      contentRevision,
    };
  },
};

function articleProposalContextError(ctx: InkPressToolContext) {
  const totalCharacters = ctx.target.markdown.length;
  if (totalCharacters <= ARTICLE_BODY_BUDGET) return null;
  const contentRevision = baseVersionHashOf(ctx);
  const readState = ctx.currentArticleReadState;
  if (
    readState?.contentRevision === contentRevision &&
    rangesCover(readState.ranges, 0, totalCharacters)
  ) {
    return null;
  }
  return {
    ok: false as const,
    code: "article-context-incomplete",
    message:
      "当前文章正文在系统上下文中被截断。请先调用 read_current_article，用 range 覆盖读取全文后，再提交完整 Markdown 提案。",
    totalCharacters,
    requiredRange: { start: 0, end: totalCharacters },
    contentRevision,
    readRanges:
      readState?.contentRevision === contentRevision
        ? mergeRanges(readState.ranges)
        : [],
  };
}

const proposeArticleRevisionTool: InkPressToolDefinition = {
  name: "propose_article_revision",
  permission: "allow",
  category: "article",
  version: "1.0.0",
  display: proposeArticleRevisionDisplay,
  description:
    "当用户要求创建或修改公众号文章时调用。提交完整 Markdown 快照供用户进行 diff 审阅，首次生成与后续修改都必须由用户确认后应用。",
  inputSchema: {
    title: z.string().max(200).optional(),
    markdown: z.string().min(1),
    digest: z.string().max(200).optional(),
    summary: z.string().min(1).max(500),
  },
  execute: async (ctx, args) => {
    if (ctx.target.kind !== "article") throw new Error("当前目标不是公众号文章。");
    const contextError = articleProposalContextError(ctx);
    if (contextError) return contextError;
    const markdown = String(args.markdown ?? "");
    const title = args.title != null ? String(args.title) : undefined;
    const digest = args.digest != null ? String(args.digest) : undefined;
    const summary = String(args.summary ?? "");
    const oldLines = ctx.target.markdown.split("\n");
    const newLines = markdown.split("\n");
    const proposal = await prisma.agentArticleProposal.create({
      data: {
        articleId: ctx.target.id,
        sessionId: ctx.sessionId,
        baseVersionHash: baseVersionHashOf(ctx),
        baseTitle: ctx.target.title,
        baseMarkdown: ctx.target.markdown,
        baseDigest: ctx.target.digest ?? ctx.target.snapshotHash ?? "",
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
        changedLines: Math.max(oldLines.length, newLines.length),
      },
    };
  },
};

const proposeTechnicalDocumentRevisionTool: InkPressToolDefinition = {
  name: "propose_technical_document_revision",
  permission: "allow",
  category: "technical-document",
  version: "1.0.0",
  display: proposeTechnicalDocumentRevisionDisplay,
  description:
    "当用户要求创建或修改技术文档时调用。提交完整 Markdown、项目快照和来源证据供审阅。",
  inputSchema: {
    title: z.string().max(200).optional(),
    markdown: z.string().min(1),
    snapshotHash: z.string().optional(),
    sourceSnapshot: z.record(z.string(), z.unknown()).optional(),
    summary: z.string().min(1).max(500),
  },
  execute: async (ctx, args) => {
    if (ctx.target.kind !== "technical-document")
      throw new Error("当前目标不是技术文档。");
    const markdown = String(args.markdown ?? "");
    const title = args.title != null ? String(args.title) : undefined;
    const snapshotHash = args.snapshotHash != null ? String(args.snapshotHash) : undefined;
    const sourceSnapshot = (args.sourceSnapshot ?? {}) as Record<string, unknown>;
    const summary = String(args.summary ?? "");
    const oldLines = ctx.target.markdown.split("\n");
    const newLines = markdown.split("\n");
    const proposal = await prisma.agentTechnicalDocumentProposal.create({
      data: {
        technicalDocumentId: ctx.target.id,
        sessionId: ctx.sessionId,
        baseVersionHash: baseVersionHashOf(ctx),
        baseTitle: ctx.target.title,
        baseMarkdown: ctx.target.markdown,
        baseSnapshotHash: ctx.target.snapshotHash ?? "",
        title: title ?? null,
        markdown,
        snapshotHash: snapshotHash ?? ctx.target.snapshotHash ?? null,
        sourceSnapshotJson: JSON.stringify({
          ...sourceSnapshot,
          ...(ctx.codeSource ? { codeSource: ctx.codeSource } : {}),
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
  },
};

const setArticleDigestTool: InkPressToolDefinition = {
  name: "set_article_digest",
  permission: "ask",
  category: "article",
  version: "1.0.0",
  display: setArticleDigestDisplay,
  description:
    "为当前公众号文章设置摘要（≤120 字），写回文章摘要字段。仅当用户要求生成摘要/一句话概括并写入摘要字段时调用；不要把摘要直接贴在对话正文里。",
  inputSchema: { digest: z.string().min(1).max(200) },
  execute: async (ctx, args) => {
    if (ctx.target.kind !== "article") throw new Error("当前目标不是公众号文章。");
    const digest = String(args.digest ?? "").trim().slice(0, 120);
    if (!digest) throw new Error("摘要不能为空。");
    await prisma.article.update({
      where: { id: ctx.target.id },
      data: { digest },
    });
    // 同步上下文摘要：保证本轮若再调 propose，baseVersionHash 与 DB 一致（apply 不 409）。
    ctx.target.digest = digest;
    // 通知前端更新编辑器摘要字段（原生 onArticleDigest 走的同一条 data part）。
    ctx.emit({
      type: "data-article-digest",
      id: crypto.randomUUID(),
      data: { digest },
    } as never);
    return { ok: true, digest };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// P4 代码工具（原子只读，Claude 主循环编排）。全部 permission="allow"，全部靠
// ctx.codeSource 守门（未授权不可读）。证据 chip 经 ctx.emit 直发 data-* part，
// 逐字对齐既有 evidence data part 的发法 → 前端 EvidenceChip 免费渲染。
// ────────────────────────────────────────────────────────────────────────────

/** 由授权 codeSource 派生 AgentProjectConfig；未授权则抛错（满足「未授权不可读」）。 */
function requireProject(ctx: InkPressToolContext): AgentProjectConfig {
  if (!ctx.codeSource) {
    throw new Error("当前没有已授权代码源，无法读取代码。请先在对话中授权一个代码项目。");
  }
  return {
    id: ctx.codeSource.id,
    name: ctx.codeSource.displayName,
    root: ctx.codeSource.root,
  };
}

const projectOverviewTool: InkPressToolDefinition = {
  name: "project_overview",
  permission: "allow",
  category: "code",
  version: "1.0.0",
  display: projectOverviewDisplay,
  description:
    "构建（或读取缓存）当前授权项目的结构索引，返回文件/符号/关系计数与快照指纹，适合先调用了解项目全貌。",
  inputSchema: {},
  annotations: { readOnlyHint: true },
  execute: async (ctx) => {
    const project = requireProject(ctx);
    const index = await getProjectIndex(project);
    const snapshotHash = await getProjectSnapshotHash(project);
    const symbols = index.symbols.length;
    const edges = index.edges.length;
    const files = index.files.length;
    const truncated = index.truncated ?? false;
    ctx.emit({
      type: "data-project-snapshot",
      id: crypto.randomUUID(),
      data: {
        projectId: project.id,
        snapshotHash,
        files,
        symbols,
        edges,
        modules: index.modules?.length,
        evidenceSymbols: symbols,
        evidenceEdges: edges,
        evidenceTruncated: false,
        mode: index.buildMode ?? "fast",
        truncated,
      },
    } as never);
    return { projectId: project.id, snapshotHash, files, symbols, edges, truncated };
  },
};

const projectSearchTool: InkPressToolDefinition = {
  name: "project_search",
  permission: "allow",
  category: "code",
  version: "1.0.0",
  display: projectSearchDisplay,
  description:
    "在当前授权项目内按关键词（或正则）搜索源码，返回 file:line 匹配。定位实现/用法时优先调用。",
  inputSchema: {
    query: z.string().min(1).max(500),
    glob: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    regex: z.boolean().optional(),
  },
  annotations: { readOnlyHint: true },
  execute: async (ctx, args) => {
    const project = requireProject(ctx);
    return searchProject(project, {
      query: String(args.query ?? ""),
      glob: args.glob != null ? String(args.glob) : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
      regex: args.regex === true,
    });
  },
};

const projectReadTool: InkPressToolDefinition = {
  name: "project_read",
  permission: "allow",
  category: "code",
  version: "1.0.0",
  display: projectReadDisplay,
  description:
    "读取当前授权项目内某个文件（可指定行范围），返回带行号的内容。路径必须是项目内相对路径。",
  inputSchema: {
    path: z.string().min(1).max(500),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  },
  annotations: { readOnlyHint: true },
  execute: async (ctx, args) => {
    const project = requireProject(ctx);
    const result = await readProjectFile(project, {
      path: String(args.path ?? ""),
      startLine: typeof args.startLine === "number" ? args.startLine : undefined,
      endLine: typeof args.endLine === "number" ? args.endLine : undefined,
    });
    ctx.emit({
      type: "data-source-evidence",
      id: crypto.randomUUID(),
      data: {
        path: result.path,
        startLine: result.startLine,
        endLine: result.endLine,
      },
    } as never);
    return result;
  },
};

const projectGlobTool: InkPressToolDefinition = {
  name: "project_glob",
  permission: "allow",
  category: "code",
  version: "1.0.0",
  display: projectGlobDisplay,
  description:
    "按 glob 模式列出当前授权项目内的文件（已排除 .git/node_modules/.next 等）。用于定位文件清单。",
  inputSchema: {
    glob: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
  annotations: { readOnlyHint: true },
  execute: async (ctx, args) => {
    const project = requireProject(ctx);
    return listProjectFiles(project, {
      glob: args.glob != null ? String(args.glob) : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    });
  },
};

/** git 工具共享：解析提交范围（支持 requestedRange/base..head/since..until）。 */
async function resolveRange(
  ctx: InkPressToolContext,
  args: Record<string, unknown>
) {
  const project = requireProject(ctx);
  const input: GitRangeInput = {
    requestedRange:
      typeof args.requestedRange === "string" ? args.requestedRange : undefined,
    base: typeof args.base === "string" ? args.base : undefined,
    head: typeof args.head === "string" ? args.head : undefined,
    since: typeof args.since === "string" ? args.since : undefined,
    until: typeof args.until === "string" ? args.until : undefined,
    maxCommits: typeof args.maxCommits === "number" ? args.maxCommits : undefined,
  };
  return resolveGitRange(project, input);
}

const gitLogTool: InkPressToolDefinition = {
  name: "git_log",
  permission: "allow",
  category: "git",
  version: "1.0.0",
  display: gitLogDisplay,
  description:
    "查看当前授权项目（须是 git 仓库）的提交历史。可给 requestedRange（如「最近7天」「本周」）或 base..head/since..until。",
  inputSchema: {
    requestedRange: z.string().max(200).optional(),
    base: z.string().max(120).optional(),
    head: z.string().max(120).optional(),
    since: z.string().max(120).optional(),
    until: z.string().max(120).optional(),
    maxCommits: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true },
  execute: async (ctx, args) => {
    const project = requireProject(ctx);
    const range = await resolveRange(ctx, args);
    const { commits, truncated } = await readGitLog(project, {
      baseCommit: range.baseCommit,
      headCommit: range.headCommit,
      maxCommits: typeof args.maxCommits === "number" ? args.maxCommits : undefined,
    });
    ctx.emit({
      type: "data-git-range",
      id: crypto.randomUUID(),
      data: {
        requestedRange: range.requestedRange,
        baseCommit: range.baseCommit,
        headCommit: range.headCommit,
      },
    } as never);
    for (const commit of commits.slice(0, 20)) {
      ctx.emit({
        type: "data-commit-evidence",
        id: commit.sha,
        data: commit,
      } as never);
    }
    return { requestedRange: range.requestedRange, commits: commits.length, truncated };
  },
};

const gitDiffSummaryTool: InkPressToolDefinition = {
  name: "git_diff_summary",
  permission: "allow",
  category: "git",
  version: "1.0.0",
  display: gitDiffSummaryDisplay,
  description:
    "查看当前授权项目某个提交范围的文件变更摘要（增删行、状态、重命名）。变更分析时与 git_log 配合取证据。",
  inputSchema: {
    requestedRange: z.string().max(200).optional(),
    base: z.string().max(120).optional(),
    head: z.string().max(120).optional(),
    since: z.string().max(120).optional(),
    until: z.string().max(120).optional(),
  },
  annotations: { readOnlyHint: true },
  execute: async (ctx, args) => {
    const project = requireProject(ctx);
    const range = await resolveRange(ctx, args);
    const { changedFiles, truncated } = await readGitDiffSummary(project, {
      baseCommit: range.baseCommit,
      headCommit: range.headCommit,
    });
    ctx.emit({
      type: "data-change-evidence-summary",
      id: crypto.randomUUID(),
      data: {
        commits: 0,
        changedFiles: changedFiles.length,
        featureGroups: 0,
        truncated,
      },
    } as never);
    return { requestedRange: range.requestedRange, changedFiles, truncated };
  },
};

const githubPullRequestTool: InkPressToolDefinition = {
  name: "github_pull_request",
  permission: "allow",
  category: "git",
  version: "1.0.0",
  display: githubPullRequestDisplay,
  description:
    "读取当前 GitHub 代码源某个 PR 的元数据、提交和文件变化（公开仓库匿名可读）。仅当代码源是 GitHub 仓库时可用。",
  inputSchema: { pullNumber: z.number().int().min(1) },
  annotations: { readOnlyHint: true, openWorldHint: true },
  execute: async (ctx, args) => {
    const cs = ctx.codeSource;
    if (!cs || cs.kind !== "github" || !cs.owner || !cs.repo) {
      throw new Error("当前代码源不是 GitHub 仓库，无法读取 PR。");
    }
    const pullNumber = Number(args.pullNumber ?? 0);
    const result = await fetchGithubPullRequest({
      owner: cs.owner,
      repo: cs.repo,
      pullNumber,
      config: ctx.agentConfig ?? ({} as AgentConfig),
    });
    for (const commit of (result.commits ?? []) as Array<{
      sha?: string;
      message?: string;
    }>) {
      const sha = String(commit.sha ?? "");
      if (!sha) continue;
      ctx.emit({
        type: "data-commit-evidence",
        id: sha,
        data: {
          sha,
          shortSha: sha.slice(0, 7),
          subject: String(commit.message ?? "").split("\n")[0],
        },
      } as never);
    }
    return result;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// P2 Web research 工具。web_search=allow（配 Tavily key 即授权联网搜索，只读）；
// web_fetch=ask（抓任意 URL 前审批，复用 P3 闸门；域名/会话记忆留 P5）。
// 来源沉淀为 data-web-source evidence（前端 EvidenceChip web-source）。
// ────────────────────────────────────────────────────────────────────────────

const webSearchTool: InkPressToolDefinition = {
  name: "web_search",
  permission: "allow",
  category: "web",
  version: "1.0.0",
  display: webSearchDisplay,
  description:
    "联网搜索最新资料（Tavily）。需要事实性信息、最新动态、外部引用时调用；每条结果带可回溯来源。需在设置里配置 Tavily API Key。",
  inputSchema: {
    query: z.string().min(1).max(500),
    maxResults: z.number().int().min(1).max(10).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  execute: async (ctx, args) => {
    const apiKey = ctx.webResearch.tavilyApiKey;
    if (!apiKey) {
      throw new Error(
        "未配置 Tavily API Key：请在「设置 → 联网搜索」填写后再联网搜索。"
      );
    }
    const { results, rawAnswer } = await searchWithTavily({
      query: String(args.query ?? ""),
      apiKey,
      maxResults: typeof args.maxResults === "number" ? args.maxResults : undefined,
    });
    for (const r of results) {
      ctx.emit({ type: "data-web-source", id: r.url, data: r } as never);
    }
    return {
      query: String(args.query ?? ""),
      results: results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        publishedAt: r.publishedAt,
      })),
      answer: rawAnswer,
      fetchedAt: results[0]?.fetchedAt,
    };
  },
};

const webFetchTool: InkPressToolDefinition = {
  name: "web_fetch",
  permission: "ask",
  category: "web",
  version: "1.0.0",
  display: webFetchDisplay,
  toContentText: (result) => {
    const r = (result ?? {}) as { title?: string; url?: string; text?: string };
    return [
      "WEB_FETCH_STATUS: SUCCESS",
      `URL: ${r.url ?? ""}`,
      `TITLE: ${r.title ?? r.url ?? "网页正文"}`,
      "",
      r.text ?? "",
    ].join("\n");
  },
  modelResultMode: "text-only",
  description:
    "读取指定网页正文（去标签后的纯文本）。已获取某 URL 想看完整内容、或验证搜索结果细节时调用。私网/本机地址会被拒绝。",
  inputSchema: {
    url: z.string().url(),
    maxChars: z.number().int().min(500).max(20000).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  execute: async (ctx, args) => {
    const result = await fetchWebPage({
      url: String(args.url ?? ""),
      maxChars: typeof args.maxChars === "number" ? args.maxChars : undefined,
    });
    ctx.emit({
      type: "data-web-source",
      id: result.url,
      data: {
        title: result.title,
        url: result.url,
        sourceType: "unknown",
        fetchedAt: result.fetchedAt,
      },
    } as never);
    return { url: result.url, title: result.title, text: result.text };
  },
};

export const INKPRESS_TOOLS: InkPressToolDefinition[] = [
  loadSkillTool,
  readSkillResourceTool,
  articleAssetsTool,
  loadSnippetsTool,
  readCurrentArticleTool,
  setArticleDigestTool,
  proposeArticleRevisionTool,
  proposeTechnicalDocumentRevisionTool,
  // P4 代码工具
  projectOverviewTool,
  projectSearchTool,
  projectReadTool,
  projectGlobTool,
  gitLogTool,
  gitDiffSummaryTool,
  githubPullRequestTool,
  // P2 Web research
  webSearchTool,
  webFetchTool,
];

/** 所有工具裸名集合（诊断/校验用）。 */
export const INKPRESS_TOOL_NAMES: string[] = INKPRESS_TOOLS.map((t) => t.name);

/**
 * 按裸名查询工具 display（MCP 包装层与测试用）。
 * 未知名兜底 { title: name, activityKind: "general" }，保证前端永远拿到可渲染的 display。
 */
export function loadInkPressToolDisplay(
  name: string,
  input: {
    phase: ToolDisplayPhase;
    args?: unknown;
    output?: unknown;
    error?: string;
    ctx: ToolDisplayContext;
  }
): ToolDisplay {
  const def = INKPRESS_TOOLS.find((t) => t.name === name);
  if (!def) return { title: name, activityKind: "general" };
  return def.display(input);
}
