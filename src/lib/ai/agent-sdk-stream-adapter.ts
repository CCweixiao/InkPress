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

export type ClaudeAgentTurnResult = {
  usage?: ClaudeAgentTurnUsage;
  costUsd?: number;
  sessionId?: string;
  isError: boolean;
  errorMessage?: string;
};

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
  result?: string;
  errors?: string[];
};

export function createSdkToUiAdapter(writer: UIStreamWriterLike) {
  let textId: string | null = null;
  let reasoningId: string | null = null;
  let streamedAnyText = false;
  let lastText = "";
  const blockKind = new Map<number, "text" | "thinking" | "other">();

  const result: ClaudeAgentTurnResult = { isError: false };

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
        const content = (m.message as { content?: AssistantContentBlock[] } | undefined)
          ?.content;
        if (Array.isArray(content)) {
          const text = content
            .filter((b) => b.type === "text" && typeof b.text === "string")
            .map((b) => b.text ?? "")
            .join("");
          if (text) lastText = text;
        }
        break;
      }
      case "result": {
        const r = m as unknown as ResultLike;
        if (r.session_id) result.sessionId = r.session_id;
        if (typeof r.total_cost_usd === "number") result.costUsd = r.total_cost_usd;
        const u = r.usage ?? {};
        const inputTokens = u.input_tokens ?? 0;
        const outputTokens = u.output_tokens ?? 0;
        result.usage = {
          inputTokens,
          outputTokens,
          reasoningTokens: 0,
          totalTokens: inputTokens + outputTokens,
        };
        if (r.subtype !== "success" || r.is_error) {
          result.isError = true;
          result.errorMessage =
            (Array.isArray(r.errors) && r.errors[0]) ||
            (typeof r.result === "string" && r.result) ||
            "Claude Agent 运行出错。";
        } else if (typeof r.result === "string" && r.result && !lastText) {
          lastText = r.result;
        }
        break;
      }
      case "system": {
        if (m.subtype === "init") {
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
          writer.write({
            type: "data-agent-step",
            id: crypto.randomUUID(),
            data: {
              kind: "intent",
              title: "上下文已自动压缩",
              detail: `${fmt(cm.pre_tokens)} → ${fmt(cm.post_tokens)} tokens${
                cm.trigger === "auto" ? "（自动）" : ""
              }`,
              status: "completed",
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
    // 全程没有增量输出时，用整段文本兜底，至少给用户一个完整回复。
    if (!streamedAnyText && lastText) {
      const id = crypto.randomUUID();
      writer.write({ type: "text-start", id } as never);
      writer.write({ type: "text-delta", id, delta: lastText } as never);
      writer.write({ type: "text-end", id } as never);
    }
  }

  return { result, consume, flush };
}
