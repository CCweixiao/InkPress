/**
 * Agent Runtime Event Protocol（P0 协议冻结）。
 *
 * 目标（docs/agent-runtime-pdc.md §4）：前端只认稳定事件，不关心后端是 TS Claude Agent SDK、
 * Python service、Go service 还是远程服务。本文定义判别联合 `AgentRuntimeEvent` 与各事件类型，
 * 以及把现有 UIMessage part 映射成该协议的 `partToAgentRuntimeEvent`。
 *
 * 设计约束：
 * - 纯类型 + 纯映射，无副作用、不 import registry.ts（registry 反向 import 本文件拿类型，避免循环）。
 * - `seq/turnId/source` 在运行时由 agent-event-writer 注入到 `part.data`（data part）或
 *   `part.toolMetadata`（tool part）——不能加顶层字段，否则 Vercel AI SDK 客户端的
 *   `strictObject` 校验会让整条 SSE 流崩溃。映射时从这两个位置回读。
 * - P0 不接渲染链路，仅供测试与后续 P6（Runtime adapter 抽象）。
 */

/** 事件来源：标识产生事件的运行时层。 */
export type AgentEventSource =
  | "claude-agent-sdk"
  | "inkpress-runtime"
  | "tool"
  | "worker";

/**
 * 所有事件的公共字段。
 * - `seq`：turn 内单调递增序号（仅 data/tool 事件占用，text/reasoning 不计数）。
 * - `ts`：时间戳；P0 暂不注入（可选），留后续时间轴需求。
 * - `subTaskId`：P4 子任务预留。
 */
export type AgentEventBase = {
  turnId: string;
  seq: number;
  source: AgentEventSource;
  ts?: string;
  subTaskId?: string;
};

/** Canonical 渲染阶段（前端按 stage 分组，同 stage 内按 seq 稳定排序）。 */
export type AgentStage =
  | "intent"
  | "context"
  | "plan"
  | "reasoning"
  | "tool"
  | "approval"
  | "evidence"
  | "proposal"
  | "output"
  | "context-compact"
  | "error";

/** 工具展示的活动类型（驱动图标/色调，P1 仅声明，图标映射留后续）。 */
export type ActivityKind =
  | "skill"
  | "read"
  | "write"
  | "search"
  | "web"
  | "review"
  | "plan"
  | "proposal"
  | "approval"
  | "general";

/** 工具产品能力分类（单一事实源，registry 的 category 字段取值）。 */
export type ToolCategory =
  | "skill"
  | "article"
  | "asset"
  | "code"
  | "git"
  | "web"
  | "memory"
  | "subtask";

/** 工具展示语义（后端生成，前端通用渲染）。 */
export type ToolDisplay = {
  title: string;
  activityKind: ActivityKind;
  summary?: string;
  icon?: string;
  metadata?: Record<string, unknown>;
};

/** 工具展示的阶段（对应 tool part 的 input-available/output-available/output-error 等时机）。 */
export type ToolDisplayPhase =
  | "selected"
  | "executing"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "loop_detected";

/**
 * display factory 上下文（最小结构，避免 import InkPressToolContext 造成循环）。
 * registry 实现的 factory 通过此类型拿到 target 元信息；args/output/error/phase 由调用点注入。
 */
export type ToolDisplayContext = {
  target: {
    kind: "article";
    id: string;
    title: string;
  };
};

/** 后端生成展示语义的工厂（每个工具在 registry 声明一条）。 */
export type ToolDisplayFactory = (input: {
  phase: ToolDisplayPhase;
  args?: unknown;
  output?: unknown;
  error?: string;
  ctx: ToolDisplayContext;
}) => ToolDisplay;

// ────────────────────────────────────────────────────────────────────────────
// 事件类型
// ────────────────────────────────────────────────────────────────────────────

export type AgentTextEvent = AgentEventBase & {
  kind: "text";
  stage: "output";
  text: string;
};

export type AgentReasoningEvent = AgentEventBase & {
  kind: "reasoning";
  stage: "reasoning";
  text: string;
};

export type AgentToolEvent = AgentEventBase & {
  kind: "tool";
  stage: "tool";
  toolName: string;
  toolCallId: string;
  phase: ToolDisplayPhase;
  input?: unknown;
  output?: unknown;
  error?: string;
  display: ToolDisplay;
};

export type AgentApprovalEvent = AgentEventBase & {
  kind: "approval";
  stage: "approval";
  approvalId: string;
  approvalType: "tool" | "code_source" | "plan" | "external_network" | "write";
  title: string;
  payload: unknown;
};

export type AgentEvidenceEvent = AgentEventBase & {
  kind: "evidence";
  stage: "evidence";
  evidenceType:
    | "source_file"
    | "git_commit"
    | "git_range"
    | "web_source"
    | "asset"
    | "project_snapshot";
  title: string;
  locator?: string;
  url?: string;
};

export type AgentContextEvent = AgentEventBase & {
  kind: "context";
  stage: "context";
  detail: string;
};

export type AgentStepEvent = AgentEventBase & {
  kind: "step";
  stage: AgentStage;
  title: string;
  detail?: string;
  status: "running" | "completed" | "failed";
};

export type AgentErrorEvent = AgentEventBase & {
  kind: "error";
  stage: "error";
  message: string;
  retryable?: boolean;
};

export type AgentRuntimeEvent =
  | AgentTextEvent
  | AgentReasoningEvent
  | AgentToolEvent
  | AgentApprovalEvent
  | AgentEvidenceEvent
  | AgentContextEvent
  | AgentStepEvent
  | AgentErrorEvent;

// ────────────────────────────────────────────────────────────────────────────
// UIMessage part → AgentRuntimeEvent 映射
// ────────────────────────────────────────────────────────────────────────────

/** 把任意字符串收敛到 AgentStage（未识别兜底 intent）。 */
function coerceStage(value: unknown): AgentStage {
  const stages: AgentStage[] = [
    "intent",
    "context",
    "plan",
    "reasoning",
    "tool",
    "approval",
    "evidence",
    "proposal",
    "output",
    "context-compact",
    "error",
  ];
  return typeof value === "string" && (stages as string[]).includes(value)
    ? (value as AgentStage)
    : "intent";
}

/**
 * 从 part 回读公共字段。data part 的 seq 在 `part.data`，tool part 的 seq 在
 * `part.toolMetadata`；二者合并读取（data 优先）。
 */
function readEventBase(part: Record<string, unknown>): AgentEventBase {
  const merged: Record<string, unknown> = {};
  const tm = part.toolMetadata;
  if (tm && typeof tm === "object") Object.assign(merged, tm);
  const d = part.data;
  if (d && typeof d === "object") Object.assign(merged, d);
  return {
    turnId: typeof merged.turnId === "string" ? merged.turnId : "",
    seq: typeof merged.seq === "number" ? merged.seq : 0,
    source:
      typeof merged.source === "string"
        ? (merged.source as AgentEventSource)
        : "inkpress-runtime",
    ...(typeof merged.subTaskId === "string"
      ? { subTaskId: merged.subTaskId }
      : {}),
  };
}

/** evidence data part 类型 → evidenceType。 */
const EVIDENCE_TYPE: Record<string, AgentEvidenceEvent["evidenceType"]> = {
  "data-source-evidence": "source_file",
  "data-commit-evidence": "git_commit",
  "data-git-range": "git_range",
  "data-project-snapshot": "project_snapshot",
};

/**
 * 把一条 UIMessage part（松结构）映射成 AgentRuntimeEvent；未识别类型返回 null。
 *
 * 映射表（对照 docs/agent-runtime-pdc.md §4 与现有前端 PART_RENDERERS）：
 * - text → text(output)；reasoning → reasoning
 * - dynamic-tool / tool-* → tool
 * - data-tool-approval / data-code-source-approval → approval
 * - data-context-usage → context
 * - data-source-evidence / data-commit-evidence / data-git-range / data-project-snapshot → evidence
 * - data-agent-step → step；data-agent-retry → error(retryable)
 */
export function partToAgentRuntimeEvent(
  part: Record<string, unknown>
): AgentRuntimeEvent | null {
  const type = typeof part.type === "string" ? part.type : "";
  const base = readEventBase(part);
  const data = (part.data ?? {}) as Record<string, unknown>;

  switch (type) {
    case "text":
      return { ...base, kind: "text", stage: "output", text: String(part.text ?? "") };
    case "reasoning":
      return { ...base, kind: "reasoning", stage: "reasoning", text: String(part.text ?? "") };
    case "dynamic-tool":
    case "tool-input-available":
    case "tool-output-available":
    case "tool-output-error":
    case "tool-input-error": {
      const toolName = String(part.toolName ?? "");
      const state = String(part.state ?? part.type ?? "");
      const phase: ToolDisplayPhase = state.includes("error")
        ? "failed"
        : state.includes("output")
          ? "completed"
          : "executing";
      const display: ToolDisplay =
        (part.toolMetadata as { display?: ToolDisplay } | undefined)?.display ?? {
          title: toolName,
          activityKind: "general",
        };
      return {
        ...base,
        kind: "tool",
        stage: "tool",
        toolName,
        toolCallId: String(part.toolCallId ?? ""),
        phase,
        ...(part.input !== undefined ? { input: part.input } : {}),
        ...(part.output !== undefined ? { output: part.output } : {}),
        ...(typeof part.errorText === "string" ? { error: part.errorText } : {}),
        display,
      };
    }
    case "data-tool-approval":
      return {
        ...base,
        kind: "approval",
        stage: "approval",
        approvalId: String(data.grantId ?? ""),
        approvalType: "tool",
        title: String(data.displayName ?? data.toolName ?? "工具授权"),
        payload: data,
      };
    case "data-code-source-approval":
      return {
        ...base,
        kind: "approval",
        stage: "approval",
        approvalId: String(data.id ?? ""),
        approvalType: "code_source",
        title: String(data.displayName ?? "代码源授权"),
        payload: data,
      };
    case "data-context-usage":
      return {
        ...base,
        kind: "context",
        stage: "context",
        detail: data.compressed
          ? `上下文已压缩：${Number(
              data.compactPreTokens ?? 0
            )} → ${Number(data.compactPostTokens ?? data.estimatedTokens ?? 0)} tokens`
          : `约 ${Number(data.estimatedTokens ?? 0)} tokens`,
      };
    case "data-source-evidence":
    case "data-commit-evidence":
    case "data-git-range":
    case "data-project-snapshot": {
      const evidenceType = EVIDENCE_TYPE[type];
      const locator =
        type === "data-source-evidence"
          ? `${String(data.path ?? "")}#L${String(data.startLine ?? "")}`
          : type === "data-commit-evidence"
            ? String(data.shortSha ?? data.sha ?? "")
            : type === "data-git-range"
              ? String(data.requestedRange ?? "")
              : String(data.snapshotHash ?? "");
      return {
        ...base,
        kind: "evidence",
        stage: "evidence",
        evidenceType,
        title:
          type === "data-commit-evidence"
            ? String(data.subject ?? locator)
            : locator || evidenceType,
        ...(locator ? { locator } : {}),
      };
    }
    case "data-change-evidence-summary":
      // 变更摘要：归为 evidence（项目快照的变更统计），无单独 evidenceType，用 project_snapshot 承载。
      return {
        ...base,
        kind: "evidence",
        stage: "evidence",
        evidenceType: "project_snapshot",
        title: `${Number(data.commits ?? 0)} 提交 · ${Number(data.changedFiles ?? 0)} 文件`,
      };
    case "data-agent-step":
      return {
        ...base,
        kind: "step",
        stage: coerceStage(data.kind),
        title: String(data.title ?? ""),
        ...(typeof data.detail === "string" && data.detail
          ? { detail: data.detail }
          : {}),
        status: ((): "running" | "completed" | "failed" => {
          const s = String(data.status ?? "completed");
          if (s === "running") return "running";
          if (s === "failed") return "failed";
          return "completed";
        })(),
      };
    case "data-agent-retry":
      return {
        ...base,
        kind: "error",
        stage: "error",
        message: `重试 ${String(data.level ?? "")} ${String(data.attempt ?? "")}/${String(data.maxRetries ?? "")}`.trim(),
        retryable: true,
      };
    default:
      return null;
  }
}
