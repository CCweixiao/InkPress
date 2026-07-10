import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * SDK message → Vercel AI SDK UIMessage part 适配器。
 *
 * 把 @anthropic-ai/claude-agent-sdk 的 SDKMessage 流映射成现有对话框已能渲染的
 * text-* / reasoning-* part（见 src/components/editor/agent-composer-parts.tsx）。
 * 仅消费 P0 关心的字段，未知事件一律忽略，保证 GLM 等兼容端点的偶发差异不会打断流。
 *
 * 注：这里用「松结构 + 可选字段」而非判别联合，避免端点偶发缺字段时类型收窄失败；
 * 字段存在性一律运行期判空。
 */

export type UIStreamWriterLike = { write: (part: never) => void };

export type ClaudeAgentTurnUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

/** 单条 assistant step 的运行时 token 采集（不持久化 step 明细，仅作中断 fallback 输入）。 */
export type RuntimeStepUsage = {
  messageId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

/**
 * 单个对话轮次的完整 usage 汇总（PDC §12.4）。
 * - source=sdk-result：来自 result.usage / total_cost_usd / modelUsage（权威）。
 * - source=step-fallback：来自内存中按 messageId 去重的 step 累加（中断/abort/无 result 兜底）。
 * - status：completed（正常 result）/ error（错误 result）/ partial（step-fallback）。
 */
export type AgentTurnUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalTokens: number;
  costUsd: number;
  modelUsage: Record<string, unknown>;
  status: "completed" | "partial" | "error";
  source: "sdk-result" | "step-fallback";
};

export type ClaudeAgentTurnResult = {
  usage?: ClaudeAgentTurnUsage;
  /** 完整轮次汇总（含 cache/cost/modelUsage/status/source）；正常与错误 result 都会填充。 */
  summary?: AgentTurnUsageSummary;
  costUsd?: number;
  sessionId?: string;
  isError: boolean;
  errorMessage?: string;
};

function unstreamedFinalText(streamedText: string, resultText: string): string {
  if (!streamedText || !resultText) return resultText;
  if (streamedText.includes(resultText)) return "";
  if (resultText.startsWith(streamedText)) return resultText.slice(streamedText.length);

  const maxOverlap = Math.min(streamedText.length, resultText.length);
  for (let length = maxOverlap; length > 0; length -= 1) {
    if (streamedText.slice(-length) === resultText.slice(0, length)) {
      return resultText.slice(length);
    }
  }
  return resultText;
}

type Delta = {
  type: string;
  text?: string;
  thinking?: string;
};

type StreamEvent = {
  type: string;
  index?: number;
  content_block?: { type: string };
  delta?: Delta;
};

type AssistantContentBlock = {
  type: string;
  text?: string;
};

type ResultLike = {
  subtype?: string;
  is_error?: boolean;
  session_id?: string;
  total_cost_usd?: number;
  usage?: Record<string, number>;
  modelUsage?: unknown;
  result?: string;
  errors?: string[];
};

type AssistantMessageLike = {
  id?: string;
  content?: AssistantContentBlock[];
  usage?: Record<string, number>;
};

export function createSdkToUiAdapter(writer: UIStreamWriterLike) {
  let textId: string | null = null;
  let reasoningId: string | null = null;
  let streamedAnyText = false;
  let streamedText = "";
  let lastText = "";
  let finalResultText = "";
  let receivedResult = false;
  const blockKind = new Map<number, "text" | "thinking" | "other">();
  const taskTypeById = new Map<string, string>();
  const openTaskIds = new Set<string>();
  const hiddenTaskIds = new Set<string>();
  const terminalTaskStatusById = new Map<string, "completed" | "failed">();
  // P1.5：assistant step usage 内存表，按 messageId 去重（同 id 取各 token 字段最大值）。
  // 仅作为中断/abort/无 result 时的 fallback 输入，绝不持久化 step 明细。
  const stepUsageByMessageId = new Map<string, RuntimeStepUsage>();

  const result: ClaudeAgentTurnResult = { isError: false };

  /** 读取 usage 对象中的 cache token（SDK 各端点字段差异，统一兜底为 0）。 */
  function readCacheTokens(u: Record<string, number> | undefined) {
    const cacheRead = u?.cache_read_input_tokens ?? 0;
    const cacheCreation = u?.cache_creation_input_tokens ?? 0;
    return { cacheRead, cacheCreation };
  }

  /** 记录一条 assistant step usage：同 messageId 取各字段最大值去重（PDC §12.4）。 */
  function recordStepUsage(messageId: string, u: Record<string, number> | undefined) {
    if (!messageId) return;
    const inputTokens = u?.input_tokens ?? 0;
    const outputTokens = u?.output_tokens ?? 0;
    const { cacheRead, cacheCreation } = readCacheTokens(u);
    const prev = stepUsageByMessageId.get(messageId);
    if (!prev) {
      stepUsageByMessageId.set(messageId, {
        messageId,
        inputTokens,
        outputTokens,
        cacheReadInputTokens: cacheRead,
        cacheCreationInputTokens: cacheCreation,
      });
      return;
    }
    prev.inputTokens = Math.max(prev.inputTokens, inputTokens);
    prev.outputTokens = Math.max(prev.outputTokens, outputTokens);
    prev.cacheReadInputTokens = Math.max(prev.cacheReadInputTokens, cacheRead);
    prev.cacheCreationInputTokens = Math.max(prev.cacheCreationInputTokens, cacheCreation);
  }

  /** 汇总 step fallback（中断/无 result 时调用）：累加去重后的 step usage。 */
  function buildStepFallbackSummary(status: AgentTurnUsageSummary["status"]): AgentTurnUsageSummary | undefined {
    if (stepUsageByMessageId.size === 0) return undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadInputTokens = 0;
    let cacheCreationInputTokens = 0;
    for (const step of stepUsageByMessageId.values()) {
      inputTokens += step.inputTokens;
      outputTokens += step.outputTokens;
      cacheReadInputTokens += step.cacheReadInputTokens;
      cacheCreationInputTokens += step.cacheCreationInputTokens;
    }
    return {
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      totalTokens: inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens,
      costUsd: 0,
      modelUsage: {},
      status,
      source: "step-fallback",
    };
  }

  function emitTurnUsage(summary: AgentTurnUsageSummary) {
    writer.write({
      type: "data-turn-usage",
      id: "turn-usage",
      data: {
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        reasoningTokens: 0,
        totalTokens: summary.totalTokens,
        cacheReadInputTokens: summary.cacheReadInputTokens,
        cacheCreationInputTokens: summary.cacheCreationInputTokens,
        costUsd: summary.costUsd,
        status: summary.status,
        source: summary.source,
      },
    } as never);
  }

  function closeTaskById(
    taskId: string,
    input: {
      status: "completed" | "failed";
      detail?: string;
      titleStatus?: "完成" | "失败";
    }
  ) {
    if (hiddenTaskIds.has(taskId)) {
      hiddenTaskIds.delete(taskId);
      taskTypeById.delete(taskId);
      openTaskIds.delete(taskId);
      return;
    }
    if (terminalTaskStatusById.has(taskId)) return;
    if (!openTaskIds.has(taskId)) return;
    const subagentType = taskTypeById.get(taskId);
    writer.write({
      type: "data-agent-step",
      id: crypto.randomUUID(),
      data: {
        kind: "intent",
        title: `子任务${input.titleStatus ?? (input.status === "completed" ? "完成" : "失败")}（${subagentType ?? "subagent"}）`,
        detail:
          input.detail ??
          (input.status === "completed"
            ? "子 agent 已返回，主 agent 正在综合结果"
            : "子 agent 未正常完成"),
        status: input.status,
        ...(subagentType ? { subagentType } : {}),
        subTaskId: taskId,
      },
    } as never);
    openTaskIds.delete(taskId);
    taskTypeById.delete(taskId);
    terminalTaskStatusById.set(taskId, input.status);
  }

  function closeAllOpenTasks(input: { status: "completed" | "failed"; detail?: string }) {
    for (const taskId of Array.from(openTaskIds)) {
      closeTaskById(taskId, input);
    }
  }

  function openText() {
    if (textId === null) {
      textId = crypto.randomUUID();
      writer.write({ type: "text-start", id: textId } as never);
    }
  }
  function closeText() {
    if (textId !== null) {
      writer.write({ type: "text-end", id: textId } as never);
      textId = null;
    }
  }
  function openReasoning() {
    if (reasoningId === null) {
      reasoningId = crypto.randomUUID();
      writer.write({ type: "reasoning-start", id: reasoningId } as never);
    }
  }
  function closeReasoning() {
    if (reasoningId !== null) {
      writer.write({ type: "reasoning-end", id: reasoningId } as never);
      reasoningId = null;
    }
  }

  function handleStreamEvent(ev: StreamEvent) {
    const index = ev.index ?? -1;
    switch (ev.type) {
      case "content_block_start": {
        const blockType = ev.content_block?.type;
        if (blockType === "text") {
          closeReasoning();
          openText();
          blockKind.set(index, "text");
        } else if (blockType === "thinking") {
          closeText();
          openReasoning();
          blockKind.set(index, "thinking");
        } else {
          // tool_use 等：P0 无工具，仅收口已打开的块。
          closeText();
          closeReasoning();
          blockKind.set(index, "other");
        }
        break;
      }
      case "content_block_delta": {
        const d = ev.delta;
        if (d?.type === "text_delta" && typeof d.text === "string") {
          openText();
          writer.write({ type: "text-delta", id: textId as string, delta: d.text } as never);
          streamedAnyText = true;
          streamedText += d.text;
        } else if (d?.type === "thinking_delta" && typeof d.thinking === "string") {
          openReasoning();
          writer.write({
            type: "reasoning-delta",
            id: reasoningId as string,
            delta: d.thinking,
          } as never);
        }
        break;
      }
      case "content_block_stop": {
        const kind = blockKind.get(index);
        blockKind.delete(index);
        if (kind === "text") closeText();
        else if (kind === "thinking") closeReasoning();
        break;
      }
      case "message_stop": {
        closeText();
        closeReasoning();
        break;
      }
      default:
        break;
    }
  }

  function consume(message: SDKMessage) {
    const m = message as Record<string, unknown> & { type: string };
    switch (m.type) {
      case "stream_event": {
        handleStreamEvent((m.event as StreamEvent | undefined) ?? { type: "unknown" });
        break;
      }
      case "assistant": {
        // 兜底：若本次没有任何增量（GLM 等可能只给整段），先记下文本，留给 flush 落出。
        const msg = (m.message as AssistantMessageLike | undefined) ?? {};
        const content = msg.content;
        if (Array.isArray(content)) {
          const text = content
            .filter((b) => b.type === "text" && typeof b.text === "string")
            .map((b) => b.text ?? "")
            .join("");
          if (text) lastText = text;
        }
        // P1.5：采集 step usage（按 messageId 去重），仅作中断 fallback。
        if (typeof msg.id === "string" && msg.id) {
          recordStepUsage(msg.id, msg.usage);
          const summary = buildStepFallbackSummary("partial");
          if (summary) emitTurnUsage(summary);
        }
        break;
      }
      case "result": {
        receivedResult = true;
        const r = m as unknown as ResultLike;
        if (r.session_id) result.sessionId = r.session_id;
        if (typeof r.total_cost_usd === "number") result.costUsd = r.total_cost_usd;
        const u = r.usage ?? {};
        const inputTokens = u.input_tokens ?? 0;
        const outputTokens = u.output_tokens ?? 0;
        const { cacheRead, cacheCreation } = readCacheTokens(u);
        const isError = r.subtype !== "success" || r.is_error;
        result.usage = {
          inputTokens,
          outputTokens,
          reasoningTokens: 0,
          totalTokens: inputTokens + outputTokens,
        };
        // 完整轮次汇总：正常与错误 result 都计入（PDC §12.4）。source=sdk-result（权威）。
        result.summary = {
          inputTokens,
          outputTokens,
          cacheReadInputTokens: cacheRead,
          cacheCreationInputTokens: cacheCreation,
          totalTokens:
            inputTokens + outputTokens + cacheRead + cacheCreation,
          costUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : 0,
          modelUsage:
            r.modelUsage && typeof r.modelUsage === "object"
              ? (r.modelUsage as Record<string, unknown>)
              : {},
          status: isError ? "error" : "completed",
          source: "sdk-result",
        };
        emitTurnUsage(result.summary);
        if (isError) {
          result.isError = true;
          result.errorMessage =
            (Array.isArray(r.errors) && r.errors[0]) ||
            (typeof r.result === "string" && r.result) ||
            "Claude Agent 运行出错。";
        } else if (typeof r.result === "string" && r.result) {
          if (!streamedAnyText && !lastText) {
            lastText = r.result;
          } else if (!streamedAnyText) {
            const existingText = lastText.trim();
            const finalText = r.result.trim();
            if (finalText && existingText !== finalText && !existingText.includes(finalText)) {
              lastText = r.result;
            }
          } else if (streamedAnyText) {
            finalResultText = unstreamedFinalText(streamedText, r.result);
          }
        }
        break;
      }
      case "system": {
        if (m.subtype === "init") {
          // 尽早捕获 SDK session id（PDC §2.3/§7.1）：system/init 早于任何 result 到达，
          // 即便用户在 result 前中断/abort，route 也能拿到 claudeAgentSessionId 用于下一轮 resume。
          // result.session_id 仍会随后覆盖（权威值），此处仅作早捕获兜底。
          if (typeof m.session_id === "string" && m.session_id) {
            result.sessionId = m.session_id;
          }
          const tools = Array.isArray(m.tools) ? m.tools.length : 0;
          const mcpServers = Array.isArray(m.mcp_servers)
            ? m.mcp_servers
                .map((server) =>
                  typeof server === "object" &&
                  server !== null &&
                  "name" in server
                    ? String((server as { name?: unknown }).name ?? "")
                    : ""
                )
                .filter(Boolean)
            : [];
          writer.write({
            type: "data-agent-step",
            id: "claude-agent-init",
            data: {
              kind: "intent",
              title: "Claude Agent 已启动",
              detail: `${String(m.model ?? "默认模型")} · ${tools} 个工具${
                mcpServers.length ? ` · MCP: ${mcpServers.join("、")}` : ""
              }`,
              status: "completed",
            },
          } as never);
        }
        // SDK 内部限流/可重试错误的轮内重试：透传给前端做实时提示（多数瞬时 429 在此化解）。
        if (m.subtype === "api_retry") {
          const error =
            typeof m.error === "string"
              ? m.error
              : m.error
                ? JSON.stringify(m.error)
                : undefined;
          writer.write({
            type: "data-agent-retry",
            id: crypto.randomUUID(),
            data: {
              level: "sdk",
              attempt: Number(m.attempt ?? 0),
              maxRetries: Number(m.max_retries ?? 0),
              delayMs: Number(m.retry_delay_ms ?? 0),
              error,
            },
          } as never);
        } else if (m.subtype === "compact_boundary") {
          // autocompact 边界：复用 data-agent-step（AgentStepBlock）展示压缩前后 token，无需新前端组件。
          const cm = (m.compact_metadata ?? {}) as Record<string, unknown>;
          const fmt = (n: unknown) =>
            typeof n === "number" ? `${(n / 1000).toFixed(1)}k` : "?";
          const preTokens =
            typeof cm.pre_tokens === "number" ? cm.pre_tokens : undefined;
          const postTokens =
            typeof cm.post_tokens === "number" ? cm.post_tokens : undefined;
          writer.write({
            type: "data-agent-step",
            id: "claude-agent-compacting",
            data: {
              kind: "intent",
              title: "上下文已自动压缩",
              detail: `${fmt(cm.pre_tokens)} → ${fmt(cm.post_tokens)} tokens${
                cm.trigger === "auto" ? "（自动）" : ""
              }`,
              status: "completed",
            },
          } as never);
          writer.write({
            type: "data-context-usage",
            id: "context-compact",
            data: {
              estimatedTokens: postTokens ?? preTokens ?? 0,
              compressed: true,
              compactTrigger: cm.trigger === "manual" ? "manual" : "auto",
              compactPreTokens: preTokens,
              compactPostTokens: postTokens,
              compactDurationMs:
                typeof cm.duration_ms === "number" ? cm.duration_ms : undefined,
            },
          } as never);
        } else if (m.subtype === "status" && m.status === "compacting") {
          writer.write({
            type: "data-agent-step",
            id: "claude-agent-compacting",
            data: {
              kind: "intent",
              title: "正在压缩上下文",
              detail: "Claude Agent 正在整理长期会话上下文",
              status: "running",
            },
          } as never);
        } else if (m.subtype === "permission_denied") {
          writer.write({
            type: "data-agent-step",
            id: crypto.randomUUID(),
            data: {
              kind: "intent",
              title: "工具权限已拒绝",
              detail:
                typeof m.decision_reason === "string" && m.decision_reason
                  ? `${String(m.tool_name ?? "工具")} · ${m.decision_reason}`
                  : String(m.tool_name ?? "工具调用未获授权"),
              status: "failed",
            },
          } as never);
        } else if (m.subtype === "mirror_error") {
          writer.write({
            type: "data-agent-step",
            id: crypto.randomUUID(),
            data: {
              kind: "intent",
              title: "会话镜像写入失败",
              detail: typeof m.error === "string" ? m.error : "SessionStore 写入失败",
              status: "failed",
            },
          } as never);
        }
        // P4：子 agent（task_*）事件 → data-agent-step，前端看到子任务进度。
        // 字段来自 SDKTaskStarted/Progress/Notification（subagent_type/task_id/summary/last_tool_name/status）。
        if (m.subtype === "task_started") {
          if (m.skip_transcript === true && typeof m.task_id === "string") {
            hiddenTaskIds.add(m.task_id);
            openTaskIds.delete(m.task_id);
            taskTypeById.delete(m.task_id);
            break;
          }
          if (typeof m.task_id === "string") {
            terminalTaskStatusById.delete(m.task_id);
          }
          if (typeof m.task_id === "string" && typeof m.subagent_type === "string") {
            taskTypeById.set(m.task_id, m.subagent_type);
          }
          if (typeof m.task_id === "string") openTaskIds.add(m.task_id);
          const subagentType =
            typeof m.subagent_type === "string"
              ? m.subagent_type
              : typeof m.task_id === "string"
                ? taskTypeById.get(m.task_id)
                : undefined;
          writer.write({
            type: "data-agent-step",
            id: crypto.randomUUID(),
            data: {
              kind: "intent",
              title: `子任务启动（${subagentType ?? "subagent"}）`,
              detail: typeof m.prompt === "string" ? m.prompt.slice(0, 160) : "",
              status: "running",
              ...(subagentType ? { subagentType } : {}),
              ...(typeof m.task_id === "string" ? { subTaskId: m.task_id } : {}),
            },
          } as never);
        } else if (m.subtype === "task_progress") {
          if (typeof m.task_id === "string" && hiddenTaskIds.has(m.task_id)) break;
          if (typeof m.task_id === "string" && terminalTaskStatusById.has(m.task_id)) break;
          if (typeof m.task_id === "string" && typeof m.subagent_type === "string") {
            taskTypeById.set(m.task_id, m.subagent_type);
          }
          const subagentType =
            typeof m.subagent_type === "string"
              ? m.subagent_type
              : typeof m.task_id === "string"
                ? taskTypeById.get(m.task_id)
                : undefined;
          writer.write({
            type: "data-agent-step",
            id: crypto.randomUUID(),
            data: {
              kind: "intent",
              title: `子任务进行中（${subagentType ?? "subagent"}）`,
              detail:
                (typeof m.summary === "string" && m.summary) ||
                (typeof m.description === "string" && m.description) ||
                (typeof m.last_tool_name === "string" ? m.last_tool_name : ""),
              status: "running",
              ...(subagentType ? { subagentType } : {}),
              ...(typeof m.task_id === "string" ? { subTaskId: m.task_id } : {}),
            },
          } as never);
        } else if (m.subtype === "task_notification") {
          if (typeof m.task_id === "string" && hiddenTaskIds.has(m.task_id)) {
            hiddenTaskIds.delete(m.task_id);
            taskTypeById.delete(m.task_id);
            openTaskIds.delete(m.task_id);
            break;
          }
          if (typeof m.task_id === "string" && terminalTaskStatusById.has(m.task_id)) {
            break;
          }
          const ok = m.status === "completed";
          const subagentType =
            typeof m.task_id === "string" ? taskTypeById.get(m.task_id) : undefined;
          writer.write({
            type: "data-agent-step",
            id: crypto.randomUUID(),
            data: {
              kind: "intent",
              title: `子任务${ok ? "完成" : "失败"}（${subagentType ?? "subagent"}）`,
              detail: typeof m.summary === "string" ? m.summary : "",
              status: ok ? "completed" : "failed",
              ...(subagentType ? { subagentType } : {}),
              ...(typeof m.task_id === "string" ? { subTaskId: m.task_id } : {}),
            },
          } as never);
          if (typeof m.task_id === "string") {
            openTaskIds.delete(m.task_id);
            taskTypeById.delete(m.task_id);
            terminalTaskStatusById.set(m.task_id, ok ? "completed" : "failed");
          }
        } else if (m.subtype === "task_updated") {
          const taskId = typeof m.task_id === "string" ? m.task_id : "";
          if (taskId && hiddenTaskIds.has(taskId)) {
            const patch =
              m.patch && typeof m.patch === "object"
                ? (m.patch as Record<string, unknown>)
                : {};
            const status = String(patch.status ?? "");
            if (status === "completed" || status === "failed" || status === "killed") {
              hiddenTaskIds.delete(taskId);
              taskTypeById.delete(taskId);
              openTaskIds.delete(taskId);
            }
            break;
          }
          const patch =
            m.patch && typeof m.patch === "object"
              ? (m.patch as Record<string, unknown>)
              : {};
          const status = String(patch.status ?? "");
          if (taskId && terminalTaskStatusById.has(taskId)) break;
          const description =
            typeof patch.description === "string" ? patch.description : "";
          if (taskId && (status === "completed" || status === "failed" || status === "killed")) {
            closeTaskById(taskId, {
              status: status === "completed" ? "completed" : "failed",
              titleStatus: status === "completed" ? "完成" : "失败",
              detail:
                description ||
                (typeof patch.error === "string" ? patch.error : undefined),
            });
          } else if (taskId && description) {
            writer.write({
              type: "data-agent-step",
              id: crypto.randomUUID(),
              data: {
                kind: "intent",
                title: `子任务进行中（${taskTypeById.get(taskId) ?? "subagent"}）`,
                detail: description,
                status: "running",
                ...(taskTypeById.get(taskId)
                  ? { subagentType: taskTypeById.get(taskId) }
                  : {}),
                subTaskId: taskId,
              },
            } as never);
          }
        }
        break;
      }
      case "rate_limit_event": {
        const info = (m.rate_limit_info ?? {}) as Record<string, unknown>;
        writer.write({
          type: "data-agent-retry",
          id: crypto.randomUUID(),
          data: {
            level: "sdk",
            attempt: 0,
            maxRetries: 0,
            delayMs: 0,
            error: `rate_limit:${String(info.status ?? "unknown")}`,
          },
        } as never);
        break;
      }
      case "tool_progress": {
        writer.write({
          type: "data-agent-step",
          id: `tool-progress-${String(m.tool_use_id ?? crypto.randomUUID())}`,
          data: {
            kind: "intent",
            title: "工具仍在运行",
            detail: `${String(m.tool_name ?? "工具")} · ${Number(
              m.elapsed_time_seconds ?? 0
            ).toFixed(0)}s`,
            status: "running",
          },
        } as never);
        break;
      }
      case "tool_use_summary": {
        if (typeof m.summary === "string" && m.summary.trim()) {
          writer.write({
            type: "data-agent-step",
            id: crypto.randomUUID(),
            data: {
              kind: "intent",
              title: "工具调用摘要",
              detail: m.summary.trim().slice(0, 500),
              status: "completed",
            },
          } as never);
        }
        break;
      }
      default:
        break;
    }
  }

  function flush() {
    closeText();
    closeReasoning();
    closeAllOpenTasks({
      status: result.isError ? "failed" : "completed",
      detail: result.isError
        ? "本轮对话结束时子 agent 仍未返回完成事件"
        : "本轮对话已收口，子 agent 结果已由主 agent 综合",
    });
    // 全程没有增量输出时，用整段文本兜底，至少给用户一个完整回复。
    if (!streamedAnyText && lastText) {
      const id = crypto.randomUUID();
      writer.write({ type: "text-start", id } as never);
      writer.write({ type: "text-delta", id, delta: lastText } as never);
      writer.write({ type: "text-end", id } as never);
    } else if (finalResultText) {
      const id = crypto.randomUUID();
      writer.write({ type: "text-start", id } as never);
      writer.write({ type: "text-delta", id, delta: finalResultText } as never);
      writer.write({ type: "text-end", id } as never);
    }
  }

  /**
   * 取本轮 usage 汇总：
   * - 有 result → result.summary（sdk-result，completed/error，权威）。
   * - 无 result（中断/abort/抛错）→ 按 messageId 去重后的 step 累加（partial，step-fallback）。
   * - 若全程无任何 usage（无 result 且无 assistant step）→ undefined（不写统计）。
   */
  function getSummary(): AgentTurnUsageSummary | undefined {
    if (result.summary) return result.summary;
    return buildStepFallbackSummary("partial");
  }

  function hasResult(): boolean {
    return receivedResult;
  }

  return { result, consume, flush, getSummary, hasResult };
}
