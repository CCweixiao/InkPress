import {
  FileSearch,
  Globe2,
  Sparkles,
  Wrench,
} from "lucide-react";

/** 工具中文名（与 ToolCallBlock 标题一致）。 */
export const TOOL_LABELS: Record<string, string> = {
  set_task_plan: "制定执行计划",
  load_skill: "补充加载 Skill",
  read_skill_resource: "读取 Skill 资源",
  web_search: "搜索网络资料",
  web_extract: "读取网页正文",
  project_search: "搜索本地代码项目",
  project_read: "读取项目文件",
  explore_project: "只读探索代码项目",
  analyze_code_changes: "分析 Git 提交与代码差异",
  github_pull_request: "读取 GitHub Pull Request",
  article_assets: "筛选文章素材",
  propose_article_revision: "生成文章修改提案",
  propose_technical_document_revision: "生成技术文档提案",
};

/** 根据工具名返回对应图标（与 ToolCallBlock 一致）。 */
export function ToolIcon({ name }: { name: string }) {
  if (name.startsWith("web_")) return <Globe2 className="h-3.5 w-3.5" />;
  if (name.startsWith("project_")) return <FileSearch className="h-3.5 w-3.5" />;
  if (name === "load_skill") return <Sparkles className="h-3.5 w-3.5" />;
  return <Wrench className="h-3.5 w-3.5" />;
}

/** 根据工具名 + 输出生成一行摘要。 */
export function summarizeTool(
  toolName: string,
  output: unknown,
  errorText?: unknown
): string {
  if (typeof errorText === "string") return errorText;
  if (!output || typeof output !== "object") return "执行完成";
  const value = output as Record<string, unknown>;
  if (toolName === "set_task_plan" && Array.isArray(value.steps)) {
    return `${value.intent ?? "任务"} · ${value.steps.length} 个步骤`;
  }
  if (toolName === "load_skill") return `已加载 ${value.name ?? value.id ?? "Skill"}`;
  if (toolName === "web_search") {
    return `获得 ${Array.isArray(value.results) ? value.results.length : 0} 条搜索结果`;
  }
  if (toolName === "project_search") {
    return `找到 ${Array.isArray(value.matches) ? value.matches.length : 0} 个匹配`;
  }
  if (toolName === "project_read") return `已读取 ${value.path ?? "项目文件"}`;
  if (toolName === "explore_project") {
    return `证据包包含 ${Array.isArray(value.symbols) ? value.symbols.length : 0} 个符号、${Array.isArray(value.edges) ? value.edges.length : 0} 条关系`;
  }
  if (toolName === "article_assets") {
    return `读取 ${Array.isArray(value.assets) ? value.assets.length : 0} 项素材`;
  }
  if (toolName === "propose_article_revision") return "文章修改提案已生成";
  return "执行完成";
}

/** 安全 JSON 格式化（与 ToolCallBlock 一致）。 */
export function formatJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 从 part 中解析工具名（支持 dynamic-tool / tool-* 前缀 / 直接 toolName 字段）。 */
export function getToolName(part: Record<string, unknown>): string {
  if (part.type === "dynamic-tool" && typeof part.toolName === "string") {
    return part.toolName;
  }
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return part.type.slice(5);
  }
  return typeof part.toolName === "string" ? part.toolName : "";
}

// ────────────────────────────────────────────────────────────────────────────
// 工具分组定义
// ────────────────────────────────────────────────────────────────────────────

/** 只读代码探索类工具：连续多次调用合并为「探索代码项目」组。 */
export const EXPLORE_TOOLS = new Set([
  "project_search",
  "project_read",
  "explore_project",
  "analyze_code_changes",
  "github_pull_request",
]);

/** 网络类工具：合并为「搜索网络资料」组。 */
export const WEB_TOOLS = new Set(["web_search", "web_extract"]);

/** 代码探索相关的数据 part 类型（流式事件，非 tool-call）。 */
export const EXPLORE_DATA_TYPES = new Set([
  "data-code-explore-step",
  "data-project-snapshot",
  "data-source-evidence",
  "data-git-range",
  "data-commit-evidence",
  "data-change-evidence-summary",
  "data-code-source-detected",
  "data-code-source-approval",
  "data-code-source-ready",
]);

/** 判断工具属于哪个分组（explore / web / null=不分组）。 */
export function getToolGroupType(
  toolName: string
): "explore" | "web" | null {
  if (EXPLORE_TOOLS.has(toolName)) return "explore";
  if (WEB_TOOLS.has(toolName)) return "web";
  return null;
}

/**
 * 判断任意 part（tool-call 或 data part）属于哪个分组。
 * 用于 aggregateParts：把 data-code-explore-step 等流式事件
 * 和 tool-explore_project 等工具调用一起归入「探索代码项目」组。
 */
export function getPartGroupType(
  part: Record<string, unknown>
): "explore" | "web" | null {
  const type = String(part.type ?? "");
  // tool-call parts
  if (type.startsWith("tool-")) {
    return getToolGroupType(type.slice(5));
  }
  if (type === "dynamic-tool") {
    return getToolGroupType(String(part.toolName ?? ""));
  }
  // data parts
  if (EXPLORE_DATA_TYPES.has(type)) return "explore";
  return null;
}

/** 为 data part 生成一行紧凑摘要（用于组内折叠展示）。 */
export function summarizeDataPart(part: Record<string, unknown>): string {
  const type = String(part.type ?? "");
  const data = (part.data ?? {}) as Record<string, unknown>;
  switch (type) {
    case "data-code-explore-step": {
      const title = String(data.title ?? "代码探索");
      const detail = String(data.detail ?? "").trim();
      return detail ? `${title}：${detail}` : title;
    }
    case "data-project-snapshot":
      return `代码快照 ${String(data.snapshotHash ?? "").slice(0, 10)} · ${Number(data.symbols ?? 0)} 符号 · ${Number(data.edges ?? 0)} 关系`;
    case "data-source-evidence":
      return `${String(data.path ?? "")}#L${String(data.startLine ?? "")}`;
    case "data-git-range":
      return `Git 范围：${String(data.requestedRange ?? "")}`;
    case "data-commit-evidence":
      return `${String(data.shortSha ?? data.sha ?? "").slice(0, 10)} ${String(data.subject ?? "")}`;
    case "data-change-evidence-summary":
      return `${Number(data.commits ?? 0)} 提交 · ${Number(data.changedFiles ?? 0)} 文件 · ${Number(data.featureGroups ?? 0)} 组变化`;
    case "data-code-source-detected":
      return `检测到 ${String(data.displayName ?? "")}`;
    case "data-code-source-ready":
      return `已就绪 ${String(data.displayName ?? "")}`;
    case "data-code-source-approval":
      return `等待授权 ${String(data.displayName ?? "")}`;
    default:
      return "";
  }
}

/**
 * 判断单个 part 是否处于流式/运行中状态。
 * 复用 ToolCallBlock 的谓词：state 含 streaming/input 或为 "call"。
 */
export function isPartStreaming(part: Record<string, unknown>): boolean {
  const state = String(part.state ?? "");
  return state.includes("streaming") || state.includes("input") || state === "call";
}

/** 组内任一 part 仍在运行时返回 true（用于组级别自动展开）。 */
export function isGroupStreaming(parts: Record<string, unknown>[]): boolean {
  return parts.some((p) => isPartStreaming(p));
}
