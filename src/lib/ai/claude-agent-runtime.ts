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
  type AgentRuntimeMetadata,
  type AgentTurnUsageSummary,
  type ClaudeAgentTurnUsage,
  type UIStreamWriterLike,
} from "@/lib/ai/agent-sdk-stream-adapter";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("ai.claude-agent");

export type RunClaudeAgentInput = {
  target: ClaudeAgentTarget;
  sessionId: string;
  /** github_pull_request / 代码工具取授权 codeSource 用。 */
  codeSource?: CodeSourceReference;
  /** P5：SDK 会话 id；非空时 resume（跨轮记忆），空则新会话。 */
  claudeAgentSessionId?: string;
  /** 编辑历史消息时要 fork 的 assistant checkpoint UUID。 */
  claudeAgentResumeSessionAt?: string;
  /** 本轮路由/斜杠命令建议 Claude 优先加载的 Skill。 */
  preferredSkillIds?: string[];
  /** 聊天框选择的供应商 id（穿透到 buildClaudeAgentOptions 动态注入模型配置）。 */
  providerId?: string | null;
  /** 聊天框选择的模型 id。 */
  modelId?: string | null;
  messages: UIMessage[];
  abortSignal?: AbortSignal;
};

export type RunClaudeAgentOutcome = {
  usage?: ClaudeAgentTurnUsage;
  /** P1.5：完整轮次 usage 汇总（含 cache/cost/modelUsage/status/source）。 */
  usageSummary?: AgentTurnUsageSummary;
  sessionId?: string;
  assistantMessageUuid?: string;
  runtimeMetadata?: AgentRuntimeMetadata;
  mirrorHealthy?: boolean;
};

type RunOnceErrorKind = "result-error" | "abort" | "throw";

type RunOnceResult = {
  outcome: RunClaudeAgentOutcome;
  error?: Error;
  errorKind?: RunOnceErrorKind;
};

/** 用最终 status/source 收口 summary（last*Tokens 快显用 input/output 派生）。 */
function finalizeOutcome(
  base: RunClaudeAgentOutcome,
  summaryInput: AgentTurnUsageSummary | undefined,
  status: AgentTurnUsageSummary["status"],
  hadSdkResult: boolean
): RunClaudeAgentOutcome {
  if (!summaryInput) return base;
  const summary: AgentTurnUsageSummary = {
    ...summaryInput,
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
  assistantMessageUuid?: string;
  runtimeMetadata?: AgentRuntimeMetadata;
  mirrorHealthy?: boolean;
};

/** 把 usage summary + sessionId 挂到错误对象上（不改变错误身份）。 */
function attachErrorPayload(
  err: Error,
  payload: {
    summary?: AgentTurnUsageSummary;
    sessionId?: string;
    assistantMessageUuid?: string;
    runtimeMetadata?: AgentRuntimeMetadata;
    mirrorHealthy?: boolean;
  }
): ClaudeAgentRuntimeError {
  const e = err as ClaudeAgentRuntimeError;
  if (payload.summary) e.usageSummary = payload.summary;
  if (payload.sessionId) e.sessionId = payload.sessionId;
  if (payload.assistantMessageUuid) {
    e.assistantMessageUuid = payload.assistantMessageUuid;
  }
  if (payload.runtimeMetadata) e.runtimeMetadata = payload.runtimeMetadata;
  if (payload.mirrorHealthy !== undefined) {
    e.mirrorHealthy = payload.mirrorHealthy;
  }
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

export function readRuntimeMetadataFromError(
  err: unknown
): AgentRuntimeMetadata | undefined {
  if (err && typeof err === "object" && "runtimeMetadata" in err) {
    const metadata = (err as { runtimeMetadata?: unknown }).runtimeMetadata;
    if (metadata && typeof metadata === "object") {
      return metadata as AgentRuntimeMetadata;
    }
  }
  return undefined;
}

export function readMirrorHealthyFromError(err: unknown): boolean | undefined {
  if (err && typeof err === "object" && "mirrorHealthy" in err) {
    const value = (err as { mirrorHealthy?: unknown }).mirrorHealthy;
    return typeof value === "boolean" ? value : undefined;
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

function terminalStreamError(input: {
  code: "timeout" | "missing-result";
  message: string;
}): Error & { code: string } {
  const error = new Error(input.message) as Error & { code: string };
  error.code = input.code;
  if (input.code === "timeout") error.name = "AbortError";
  return error;
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
    claudeAgentResumeSessionAt: input.claudeAgentResumeSessionAt,
    preferredSkillIds: input.preferredSkillIds,
    providerId: input.providerId,
    modelId: input.modelId,
    lastUserText: prompt,
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
    if (!adapter.hasResult()) {
      const aborted = input.abortSignal?.aborted || abortController.signal.aborted;
      return {
        outcome: {
          usageSummary: adapter.getSummary(),
          sessionId: adapter.result.sessionId,
          assistantMessageUuid: adapter.result.assistantMessageUuid,
          runtimeMetadata: adapter.result.runtimeMetadata,
          mirrorHealthy: adapter.result.mirrorHealthy,
        },
        error: terminalStreamError(
          aborted
            ? {
                code: "timeout",
                message: "Claude Agent 运行已中止或超时，SDK 流未返回最终结果。",
              }
            : {
                code: "missing-result",
                message: "Claude Agent SDK 流已结束，但未返回最终结果。",
              }
        ),
        errorKind: aborted ? "abort" : "throw",
      };
    }
  } catch (err) {
    // for-await 抛错（abort / 网络 / 限流穿透）：尽量用 step fallback 兜底 usage。
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      outcome: {
        usageSummary: adapter.getSummary(),
        sessionId: adapter.result.sessionId,
        assistantMessageUuid: adapter.result.assistantMessageUuid,
        runtimeMetadata: adapter.result.runtimeMetadata,
        mirrorHealthy: adapter.result.mirrorHealthy,
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
        assistantMessageUuid: result.assistantMessageUuid,
        runtimeMetadata: result.runtimeMetadata,
        mirrorHealthy: result.mirrorHealthy,
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
      assistantMessageUuid: result.assistantMessageUuid,
      runtimeMetadata: result.runtimeMetadata,
      mirrorHealthy: result.mirrorHealthy,
    },
  };
}

/**
 * 运行 Claude Agent Runtime（单次 SDK query）。
 *
 * - 用最近一条 user 消息作为单轮 prompt（多轮记忆由 Claude Agent SDK session/resume 承载）。
 * - 不做应用层整轮 retry：SDK 自身的 api_retry 可安全重试单次 API 调用；应用层重建
 *   query 会 replay 工具副作用，故 rate-limit/result-error 直接上抛。
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

  const { outcome, error, errorKind } = await runOnce(input, writer, prompt);
  const hadSdkResult = outcome.usageSummary?.source === "sdk-result";

  if (!error) {
    return finalizeOutcome(outcome, outcome.usageSummary, "completed", hadSdkResult);
  }

  // 用户取消 / 断连中止：挂 partial usage + sessionId 后上抛（route 归类为「对话已取消」）。
  if (errorKind === "abort" || isAbortError(error)) {
    throw attachErrorPayload(error, {
      summary: finalizeOutcome(outcome, outcome.usageSummary, "partial", hadSdkResult)
        .usageSummary,
      sessionId: outcome.sessionId,
      assistantMessageUuid: outcome.assistantMessageUuid,
      runtimeMetadata: outcome.runtimeMetadata,
      mirrorHealthy: outcome.mirrorHealthy,
    });
  }

  throw attachErrorPayload(error, {
    summary: finalizeOutcome(outcome, outcome.usageSummary, "error", hadSdkResult)
      .usageSummary,
    sessionId: outcome.sessionId,
    assistantMessageUuid: outcome.assistantMessageUuid,
    runtimeMetadata: outcome.runtimeMetadata,
    mirrorHealthy: outcome.mirrorHealthy,
  });
}
