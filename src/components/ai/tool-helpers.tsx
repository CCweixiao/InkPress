import {
  FileSearch,
  Globe2,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { ToolDisplay } from "@/lib/ai/agent-runtime-events";

// ────────────────────────────────────────────────────────────────────────────
// 工具描述符注册表（单一事实源）
// 新增一个工具只需在此加一条：label（中文名）+ group（分组归属）+ summarize（一行摘要）。
// TOOL_LABELS / EXPLORE_TOOLS / WEB_TOOLS / summarizeTool 均由此派生，避免分散到多处常量表。
// ────────────────────────────────────────────────────────────────────────────

type ToolGroup = "explore" | "web";

type ToolDescriptor = {
  /** 中文名（ToolCallBlock / ToolGroupBlock 标题一致）。 */
  label: string;
  /** 分组归属：连续同组工具在 UI 折叠成一个组；不分组则省略。 */
  group?: ToolGroup;
  /** 由工具 output 生成一行摘要；省略则回退「执行完成」。 */
  summarize?: (value: Record<string, unknown>) => string;
};

const TOOL_REGISTRY: Record<string, ToolDescriptor> = {
  set_task_plan: {
    label: "制定执行计划",
    summarize: (v) =>
      Array.isArray(v.steps)
        ? `${v.intent ?? "任务"} · ${v.steps.length} 个步骤`
        : "执行完成",
  },
  load_skill: {
    label: "补充加载 Skill",
    summarize: (v) => `已加载 ${v.name ?? v.id ?? "Skill"}`,
  },
  read_skill_resource: { label: "读取 Skill 资源" },
  web_search: {
    label: "搜索网络资料",
    group: "web",
    summarize: (v) =>
      `获得 ${Array.isArray(v.results) ? v.results.length : 0} 条搜索结果`,
  },
  web_fetch: { label: "读取网页正文", group: "web" },
  project_search: {
    label: "搜索本地代码项目",
    group: "explore",
    summarize: (v) =>
      `找到 ${Array.isArray(v.matches) ? v.matches.length : 0} 个匹配`,
  },
  project_read: {
    label: "读取项目文件",
    group: "explore",
    summarize: (v) => `已读取 ${v.path ?? "项目文件"}`,
  },
  project_overview: {
    label: "项目结构概览",
    group: "explore",
    summarize: (v) =>
      `索引 ${Number(v.files ?? 0)} 文件 · ${Number(v.symbols ?? 0)} 符号 · ${Number(v.edges ?? 0)} 关系`,
  },
  project_glob: {
    label: "列出项目文件",
    group: "explore",
    summarize: (v) => {
      const total = Number(v.total ?? 0);
      const files = v.files;
      return `匹配 ${total || (Array.isArray(files) ? files.length : 0)} 个文件`;
    },
  },
  git_log: {
    label: "查看提交历史",
    group: "explore",
    summarize: (v) => `${Number(v.commits ?? 0)} 条提交`,
  },
  git_diff_summary: {
    label: "查看变更摘要",
    group: "explore",
    summarize: (v) => {
      const cf = v.changedFiles;
      return `${Array.isArray(cf) ? cf.length : 0} 个文件变更`;
    },
  },
  explore_project: {
    label: "只读探索代码项目",
    group: "explore",
    summarize: (v) =>
      `证据包包含 ${Array.isArray(v.symbols) ? v.symbols.length : 0} 个符号、${Array.isArray(v.edges) ? v.edges.length : 0} 条关系`,
  },
  analyze_code_changes: {
    label: "分析 Git 提交与代码差异",
    group: "explore",
  },
  github_pull_request: {
    label: "读取 GitHub Pull Request",
    group: "explore",
  },
  article_assets: {
    label: "筛选文章素材",
    summarize: (v) =>
      `读取 ${Array.isArray(v.assets) ? v.assets.length : 0} 项素材`,
  },
  set_article_digest: {
    label: "设置文章摘要",
    summarize: () => "已写入摘要字段",
  },
  propose_article_revision: {
    label: "生成文章修改提案",
    summarize: () => "文章修改提案已生成",
  },
};

/** 工具中文名（由注册表派生，与 ToolCallBlock 标题一致）。 */
export const TOOL_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_REGISTRY).map(([name, descriptor]) => [
    name,
    descriptor.label,
  ])
);

/** 根据工具名返回对应图标（与 ToolCallBlock 一致）。 */
export function ToolIcon({ name }: { name: string }) {
  if (name.startsWith("web_")) return <Globe2 className="h-3.5 w-3.5" />;
  if (name.startsWith("project_")) return <FileSearch className="h-3.5 w-3.5" />;
  if (name === "load_skill") return <Sparkles className="h-3.5 w-3.5" />;
  return <Wrench className="h-3.5 w-3.5" />;
}

/** 根据工具名 + 输出生成一行摘要（由注册表的 summarize 派生）。 */
export function summarizeTool(
  toolName: string,
  output: unknown,
  errorText?: unknown,
  display?: ToolDisplay | null
): string {
  if (typeof errorText === "string") return errorText;
  // P1：优先用后端 display.summary；否则回退 TOOL_REGISTRY.summarize（历史消息/未迁移工具）。
  if (display?.summary) return display.summary;
  if (!output || typeof output !== "object") return "执行完成";
  const value = output as Record<string, unknown>;
  return TOOL_REGISTRY[toolName]?.summarize?.(value) ?? "执行完成";
}

/**
 * 从 tool part 的 toolMetadata.display 读取后端生成的展示语义（P1）。
 * 未带 display（历史消息/未迁移工具）返回 null，调用方回退 TOOL_REGISTRY。
 */
export function getToolDisplay(part: Record<string, unknown>): ToolDisplay | null {
  const tm = part.toolMetadata;
  if (!tm || typeof tm !== "object") return null;
  const raw = (tm as { display?: unknown }).display;
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.title !== "string") return null;
  const display: ToolDisplay = {
    title: d.title,
    activityKind:
      typeof d.activityKind === "string"
        ? (d.activityKind as ToolDisplay["activityKind"])
        : "general",
  };
  if (typeof d.summary === "string") display.summary = d.summary;
  if (typeof d.icon === "string") display.icon = d.icon;
  if (d.metadata && typeof d.metadata === "object")
    display.metadata = d.metadata as Record<string, unknown>;
  return display;
}

/** 从 tool part 读取 activityKind（P1 仅声明，图标映射留后续）。 */
export function getToolActivityKind(
  part: Record<string, unknown>
): ToolDisplay["activityKind"] | null {
  return getToolDisplay(part)?.activityKind ?? null;
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
  if (typeof part.toolName === "string") return part.toolName;
  if (part.type === "dynamic-tool" && typeof part.toolName === "string") {
    return part.toolName;
  }
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return part.type.slice(5);
  }
  return "";
}

// ────────────────────────────────────────────────────────────────────────────
// 工具分组定义
// ────────────────────────────────────────────────────────────────────────────

/** 某分组的工具名集合（由注册表 group 字段派生）。 */
function toolsInGroup(group: ToolGroup): Set<string> {
  return new Set(
    Object.entries(TOOL_REGISTRY)
      .filter(([, descriptor]) => descriptor.group === group)
      .map(([name]) => name)
  );
}

/** 只读代码探索类工具：连续多次调用合并为「探索代码项目」组。 */
export const EXPLORE_TOOLS = toolsInGroup("explore");

/** 网络类工具：合并为「搜索网络资料」组。 */
export const WEB_TOOLS = toolsInGroup("web");

/**
 * 代码探索相关的数据 part 类型（流式事件，非 tool-call）。
 * 注意：data-code-source-detected / approval / ready 不在此列——它们是代码源
 * 生命周期的交互式 UI（授权卡片 / 就绪通知），有专用 PART_RENDERERS，
 * 被 aggregateParts 折叠进 ToolGroupBlock 会丢失按钮交互。
 */
export const EXPLORE_DATA_TYPES = new Set([
  "data-code-explore-step",
  "data-project-snapshot",
  "data-source-evidence",
  "data-git-range",
  "data-commit-evidence",
  "data-change-evidence-summary",
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
    return getToolGroupType(getToolName(part));
  }
  if (type === "dynamic-tool") {
    return getToolGroupType(String(part.toolName ?? ""));
  }
  // data parts
  if (EXPLORE_DATA_TYPES.has(type)) return "explore";
  if (type === "data-web-source") return "web";
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
    case "data-project-snapshot": {
      const files = data.files != null ? `${Number(data.files)} 文件 · ` : "";
      const capped = data.evidenceTruncated
        ? ` · 证据包 ${Number(data.evidenceSymbols ?? 0)}/${Number(data.evidenceEdges ?? 0)}`
        : "";
      const mode = data.mode === "fallback-index" ? " · 静态索引模式" : "";
      const indexStatus = data.truncated ? " · 索引触顶" : "";
      return `代码快照 ${String(data.snapshotHash ?? "").slice(0, 10)} · ${files}${Number(data.symbols ?? 0)} 符号 · ${Number(data.edges ?? 0)} 关系${mode}${capped}${indexStatus}`;
    }
    case "data-source-evidence":
      return `${String(data.path ?? "")}#L${String(data.startLine ?? "")}`;
    case "data-web-source":
      return String(data.title ?? data.url ?? "");
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
