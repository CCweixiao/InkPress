import {
  query,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { UIMessage } from "ai";
import {
  buildClaudeAgentOptions,
  type ClaudeAgentTarget,
} from "@/lib/ai/claude-agent-options";
import type { CodeSourceReference } from "@/lib/ai/code-source";
import {
  createSdkToUiAdapter,
  type ClaudeAgentTurnUsage,
  type UIStreamWriterLike,
} from "@/lib/ai/agent-sdk-stream-adapter";
import { isRateLimitError } from "@/lib/ai/error-classify";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("ai.claude-agent");

/** 限流重试参数（env 可覆盖）。默认 10 次、每次等待 10 分钟。 */
const RATE_LIMIT_MAX_RETRIES = Number(
  process.env.INKPRESS_RATE_LIMIT_MAX_RETRIES ?? 10
);
const RATE_LIMIT_RETRY_WAIT_MS = Number(
  process.env.INKPRESS_RATE_LIMIT_RETRY_WAIT_MS ?? 10 * 60_000
);

export type RunClaudeAgentInput = {
  target: ClaudeAgentTarget;
  sessionId: string;
  /** 仅 propose_technical_document_revision 的 sourceSnapshotJson 用。 */
  codeSource?: CodeSourceReference;
  /** P5：SDK 会话 id；非空时 resume（跨轮记忆），空则新会话。 */
  claudeAgentSessionId?: string;
  /** 本轮路由/斜杠命令建议 Claude 优先加载的 Skill。 */
  preferredSkillIds?: string[];
  messages: UIMessage[];
  abortSignal?: AbortSignal;
};

export type RunClaudeAgentOutcome = {
  usage?: ClaudeAgentTurnUsage;
  sessionId?: string;
};

/** 取最近一条用户消息的纯文本作为 query 的 prompt（P0 单轮）。 */
function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text = (message.parts ?? [])
      .filter((part) => (part as { type?: string }).type === "text")
      .map((part) => (part as { text?: string }).text ?? "")
      .join("");
    if (text.trim()) return text;
  }
  return "";
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** 可中止的 sleep：到 ms 后 resolve；signal abort 时立即 reject（AbortError）。 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 单轮运行：构造 options + 跑 SDK query 流 + 适配进 UIMessage。
 * result.isError（含限流用尽）时抛出，交由上层重试循环或 route onError 处理。
 */
async function runOnce(
  input: RunClaudeAgentInput,
  writer: UIStreamWriterLike,
  prompt: string
): Promise<RunClaudeAgentOutcome> {
  const baseOptions = await buildClaudeAgentOptions({
    target: input.target,
    sessionId: input.sessionId,
    codeSource: input.codeSource,
    claudeAgentSessionId: input.claudeAgentSessionId,
    preferredSkillIds: input.preferredSkillIds,
    emit: (part) => writer.write(part),
  });

  // 每轮用新的 AbortController 桥接请求级信号（重试时上一轮的 controller 可能已废）。
  const abortController = new AbortController();
  if (input.abortSignal) {
    if (input.abortSignal.aborted) abortController.abort();
    else
      input.abortSignal.addEventListener("abort", () => abortController.abort(), {
        once: true,
      });
  }

  const options: Options = {
    ...baseOptions,
    abortController,
    stderr: (data) => {
      const text = typeof data === "string" ? data.trim() : "";
      if (text) log.warn({ stderr: text }, "claude-agent-sdk 子进程 stderr");
    },
  };

  const adapter = createSdkToUiAdapter(writer);
  const stream = query({ prompt, options });
  for await (const message of stream) {
    adapter.consume(message as SDKMessage);
  }
  adapter.flush();

  const { result } = adapter;
  if (result.isError) {
    throw new Error(result.errorMessage || "Claude Agent 运行出错。");
  }
  return { usage: result.usage, sessionId: result.sessionId };
}

/**
 * 限流重试外壳：runOnce 失败若为限流 → sleep（可中止）后重试，最多 maxRetries 次。
 * 抽出为独立函数便于单测（probe 用小 waitMs + mock runOnce 验证重试/用尽/中止语义）。
 *
 - 用户取消（AbortError）或非限流错误或重试用尽 → 立即上抛。
 - 每次重试前调 onRetry(attempt)（runtime 用它下发 data-agent-retry）。
 */
export async function retryOnRateLimit<R>(
  runOnce: () => Promise<R>,
  opts: {
    signal?: AbortSignal;
    onRetry: (attempt: number) => void;
    maxRetries?: number;
    waitMs?: number;
  }
): Promise<R> {
  const maxRetries = opts.maxRetries ?? RATE_LIMIT_MAX_RETRIES;
  const waitMs = opts.waitMs ?? RATE_LIMIT_RETRY_WAIT_MS;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await runOnce();
    } catch (err) {
      if (isAbortError(err)) throw err;
      if (!isRateLimitError(err) || attempt > maxRetries) throw err;
      opts.onRetry(attempt);
      log.warn({ attempt, maxRetries }, "claude agent 限流，sleep 后整轮重试");
      try {
        await abortableSleep(waitMs, opts.signal);
      } catch {
        // sleep 期间用户取消 → 当作 abort 上抛（route 归类为「对话已取消」）。
        throw new DOMException("aborted", "AbortError");
      }
    }
  }
}

/**
 * 运行 Claude Agent Runtime（带限流重试）。
 *
 * - 用最近一条 user 消息作为单轮 prompt（多轮记忆留待 P5 resume）。
 * - 单轮失败若为**限流**（429/访问量过大）→ sleep（最多 RATE_LIMIT_RETRY_WAIT_MS，可中止）
 *   后**整轮重试**，最多 RATE_LIMIT_MAX_RETRIES 次；每次重试前下发 `data-agent-retry`
 *   `{level:"turn"}` 让前端展示「第 N/M 轮重试 + 倒计时」。
 * - SDK 自身的轮内重试（api_retry）由 adapter 透传为 `data-agent-retry {level:"sdk"}`。
 * - 非限流错误 / 重试用尽 / 用户取消 → 上抛，交由 route onError 归类展示。
 */
export async function runClaudeAgentRuntime(
  input: RunClaudeAgentInput,
  writer: UIStreamWriterLike
): Promise<RunClaudeAgentOutcome> {
  const prompt = lastUserText(input.messages);
  if (!prompt.trim()) {
    throw new Error("没有可发送的用户消息。");
  }

  return retryOnRateLimit(() => runOnce(input, writer, prompt), {
    signal: input.abortSignal,
    onRetry: (attempt) => {
      writer.write({
        type: "data-agent-retry",
        id: crypto.randomUUID(),
        data: {
          level: "turn",
          attempt,
          maxRetries: RATE_LIMIT_MAX_RETRIES,
          waitMs: RATE_LIMIT_RETRY_WAIT_MS,
        },
      } as never);
    },
  });
}
