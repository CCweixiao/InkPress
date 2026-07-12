export const DEFAULT_AGENT_RUN_TIMEOUT_MS = 15 * 60 * 1000;

export type RunAbortReason =
  | { code: "request-aborted" }
  | { code: "runtime-timeout"; timeoutMs: number };

export function agentRunTimeoutMs(): number {
  const configured = Number(process.env.INKPRESS_AGENT_RUN_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 30_000) {
    return Math.min(Math.floor(configured), 60 * 60 * 1000);
  }
  return DEFAULT_AGENT_RUN_TIMEOUT_MS;
}

export function createRunAbortSignal(
  requestSignal: AbortSignal,
  timeoutMs: number
): AbortSignal {
  const controller = new AbortController();
  const normalizedTimeoutMs = Math.max(1, timeoutMs);
  const abort = (reason: RunAbortReason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };

  if (requestSignal.aborted) {
    abort({ code: "request-aborted" });
    return controller.signal;
  }

  const timer = setTimeout(
    () => abort({ code: "runtime-timeout", timeoutMs: normalizedTimeoutMs }),
    normalizedTimeoutMs
  );
  requestSignal.addEventListener(
    "abort",
    () => abort({ code: "request-aborted" }),
    { once: true }
  );
  controller.signal.addEventListener("abort", () => clearTimeout(timer), {
    once: true,
  });
  return controller.signal;
}

export function readRunAbortReason(signal?: AbortSignal): RunAbortReason | undefined {
  const reason = signal?.reason;
  if (!reason || typeof reason !== "object") return undefined;
  const code = (reason as { code?: unknown }).code;
  if (code === "request-aborted") return { code };
  if (code === "runtime-timeout") {
    const timeoutMs = (reason as { timeoutMs?: unknown }).timeoutMs;
    return {
      code,
      timeoutMs: typeof timeoutMs === "number" ? timeoutMs : 0,
    };
  }
  return undefined;
}
