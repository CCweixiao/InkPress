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
  type AgentTurnUsageSummary,
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
  /** P1.5：完整轮次 usage 汇总（含 cache/cost/modelUsage/status/source）。 */
  usageSummary?: AgentTurnUsageSummary;
  sessionId?: string;
};

type RunOnceErrorKind = "result-error" | "abort" | "throw";

type RunOnceResult = {
  outcome: RunClaudeAgentOutcome;
  error?: Error;
  errorKind?: RunOnceErrorKind;
};

/** 合并两次 attempt 的 usage 汇总（限流重试累加，PDC §12.5）。status/source 由调用方按最终结果重写。 */
function mergeUsageSummaries(
  acc: AgentTurnUsageSummary | undefined,
  next: AgentTurnUsageSummary
): AgentTurnUsageSummary {
  if (!acc) return { ...next };
  return {
    inputTokens: acc.inputTokens + next.inputTokens,
    outputTokens: acc.outputTokens + next.outputTokens,
    cacheReadInputTokens: acc.cacheReadInputTokens + next.cacheReadInputTokens,
    cacheCreationInputTokens:
      acc.cacheCreationInputTokens + next.cacheCreationInputTokens,
    totalTokens: acc.totalTokens + next.totalTokens,
    costUsd: acc.costUsd + next.costUsd,
    // 同模型多次 attempt：保留每次的 modelUsage 数组拼接；跨模型时由调用方不关心明细。
    modelUsage: mergeModelUsageObjects(acc.modelUsage, next.modelUsage),
    status: next.status,
    source: next.source,
  };
}

function mergeModelUsageObjects(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, unknown> {
  // 同一 turn 内模型一般一致；跨 attempt 取最近一次非空的 modelUsage（数组或对象均可）。
  const has = (v: Record<string, unknown>) =>
    Array.isArray(v) ? v.length > 0 : !!v && Object.keys(v).length > 0;
  return has(b) ? b : has(a) ? a : b;
}

/** 用最终 status/source 收口合并后的 summary（last*Tokens 快显用 input/output 派生）。 */
function finalizeOutcome(
  base: RunClaudeAgentOutcome,
  merged: AgentTurnUsageSummary | undefined,
  status: AgentTurnUsageSummary["status"],
  hadSdkResult: boolean
): RunClaudeAgentOutcome {
  if (!merged) return base;
  const summary: AgentTurnUsageSummary = {
    ...merged,
    status,
    source: hadSdkResult ? "sdk-result" : "step-fallback",
  };
  return {
    ...base,
    usageSummary: summary,
    usage: {
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      reasoningTokens: 0,
      // 上下文计量口径：input+output（cache 不计入上下文窗口占用，与既有 TokenMeter 一致）。
      totalTokens: summary.inputTokens + summary.outputTokens,
    },
  };
}

/**
 * Runtime 抛出错误时携带的附加载荷（PDC §7.2）。
 * - usageSummary：失败/中断轮次的用量（route catch 持久化到 ledger）。
 * - sessionId：本轮已捕获的 Claude SDK session id（早自 system/init，route catch 落
 *   claudeAgentSessionId，保证中断后下一轮可 resume）。
 * 挂载到错误对象上，不改变错误身份（AbortError 仍可被 isAbortError 识别）。
 */
export type ClaudeAgentRuntimeError = Error & {
  usageSummary?: AgentTurnUsageSummary;
  sessionId?: string;
};

/** 把 usage summary + sessionId 挂到错误对象上（不改变错误身份）。 */
function attachErrorPayload(
  err: Error,
  payload: { summary?: AgentTurnUsageSummary; sessionId?: string }
): ClaudeAgentRuntimeError {
  const e = err as ClaudeAgentRuntimeError;
  if (payload.summary) e.usageSummary = payload.summary;
  if (payload.sessionId) e.sessionId = payload.sessionId;
  return e;
}

/** 从错误对象上读回挂载的 usage summary（route 在 catch 分支持久化失败轮次用量）。 */
export function readUsageFromError(
  err: unknown
): AgentTurnUsageSummary | undefined {
  if (err && typeof err === "object" && "usageSummary" in err) {
    const summary = (err as { usageSummary?: unknown }).usageSummary;
    if (summary && typeof summary === "object") {
      return summary as AgentTurnUsageSummary;
    }
  }
  return undefined;
}

/**
 * 从错误对象上读回挂载的 Claude SDK session id（PDC §7.2）。
 * route catch 分支用它落 AgentChatSession.claudeAgentSessionId，使中断/错误后下一轮可 resume。
 */
export function readSessionFromError(err: unknown): string | undefined {
  if (err && typeof err === "object" && "sessionId" in err) {
    const sessionId = (err as { sessionId?: unknown }).sessionId;
    if (typeof sessionId === "string" && sessionId) return sessionId;
  }
  return undefined;
}

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
 *
 * 不再「result.isError 时直接 throw 丢弃 usage」：把 outcome（含 usageSummary）连同 error 一起返回，
 * 由上层 runClaudeAgentRuntime 决定重试/收口，并在最终错误上挂载 usageSummary（route catch 时持久化）。
 * - result.isError → errorKind="result-error"，仍带 summary（status=error, sdk-result）。
 * - for-await 抛错（abort/网络/限流穿透）→ 尽量用 step fallback 兜底 summary（status=partial）。
 */
async function runOnce(
  input: RunClaudeAgentInput,
  writer: UIStreamWriterLike,
  prompt: string
): Promise<RunOnceResult> {
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
  try {
    const stream = query({ prompt, options });
    for await (const message of stream) {
      adapter.consume(message as SDKMessage);
    }
    adapter.flush();
  } catch (err) {
    // for-await 抛错（abort / 网络 / 限流穿透）：尽量用 step fallback 兜底 usage。
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      outcome: {
        usageSummary: adapter.getSummary(),
        sessionId: adapter.result.sessionId,
      },
      error,
      errorKind: isAbortError(error) ? "abort" : "throw",
    };
  }

  const { result } = adapter;
  const usageSummary = adapter.getSummary();
  if (result.isError) {
    return {
      outcome: {
        usage: result.usage,
        usageSummary,
        sessionId: result.sessionId,
      },
      error: new Error(result.errorMessage || "Claude Agent 运行出错。"),
      errorKind: "result-error",
    };
  }
  return {
    outcome: {
      usage: result.usage,
      usageSummary,
      sessionId: result.sessionId,
    },
  };
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
 * 运行 Claude Agent Runtime（带限流重试 + 跨 attempt usage 合并）。
 *
 * - 用最近一条 user 消息作为单轮 prompt（多轮记忆由 Claude Agent SDK session/resume 承载）。
 * - 单轮失败若为**限流**（429/访问量过大）→ sleep（最多 RATE_LIMIT_RETRY_WAIT_MS，可中止）
 *   后**整轮重试**，最多 RATE_LIMIT_MAX_RETRIES 次；每次重试前下发 `data-agent-retry`
 *   `{level:"turn"}` 让前端展示「第 N/M 轮重试 + 倒计时」。
 * - 跨 attempt 的 usage 按用户轮次累加（PDC §12.5）：失败 attempt 已产生的 cost/usage
 *   合并进最终 AgentUsageTurn，最终 status 由收口结果决定（completed/error/partial）。
 * - SDK 自身的轮内重试（api_retry）由 adapter 透传为 `data-agent-retry {level:"sdk"}`。
 * - 成功 → 返回 outcome（usage + usageSummary）；失败/中止 → throw error（携带 usageSummary，
 *   route catch 时持久化失败轮次用量，避免「失败不消耗」的误解）。
 */
export async function runClaudeAgentRuntime(
  input: RunClaudeAgentInput,
  writer: UIStreamWriterLike
): Promise<RunClaudeAgentOutcome> {
  const prompt = lastUserText(input.messages);
  if (!prompt.trim()) {
    throw new Error("没有可发送的用户消息。");
  }

  let merged: AgentTurnUsageSummary | undefined;
  let hadSdkResult = false;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const { outcome, error, errorKind } = await runOnce(input, writer, prompt);
    if (outcome.usageSummary) {
      if (outcome.usageSummary.source === "sdk-result") hadSdkResult = true;
      merged = mergeUsageSummaries(merged, outcome.usageSummary);
    }

    if (!error) {
      return finalizeOutcome(outcome, merged, "completed", hadSdkResult);
    }

    // 用户取消 / 断连中止：不再重试，挂 partial usage + sessionId 后上抛（route 归类为「对话已取消」）。
    // sessionId 即便在 result 前 abort（仅收到 system/init）也能带出，供下一轮 resume（PDC §5.2）。
    if (errorKind === "abort" || isAbortError(error)) {
      throw attachErrorPayload(error, {
        summary: finalizeOutcome(outcome, merged, "partial", hadSdkResult)
          .usageSummary,
        sessionId: outcome.sessionId,
      });
    }

    // 非限流错误 / 重试用尽：挂 error usage + sessionId 后上抛（route onError 归类展示）。
    // result-error 也可能是 SDK result 承载的 429/访问量过大，仍需进入整轮重试。
    if (!isRateLimitError(error) || attempt > RATE_LIMIT_MAX_RETRIES) {
      throw attachErrorPayload(error, {
        summary: finalizeOutcome(outcome, merged, "error", hadSdkResult)
          .usageSummary,
        sessionId: outcome.sessionId,
      });
    }

    // 限流：下发「整轮重试」提示后可中止 sleep，再重试。
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
    log.warn({ attempt, maxRetries: RATE_LIMIT_MAX_RETRIES }, "claude agent 限流，sleep 后整轮重试");
    try {
      await abortableSleep(RATE_LIMIT_RETRY_WAIT_MS, input.abortSignal);
    } catch {
      // sleep 期间用户取消 → 当作 abort 上抛（route 归类为「对话已取消」）。
      throw attachErrorPayload(new DOMException("aborted", "AbortError"), {
        summary: finalizeOutcome(outcome, merged, "partial", hadSdkResult)
          .usageSummary,
        sessionId: outcome.sessionId,
      });
    }
  }
}
