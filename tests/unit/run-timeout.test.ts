import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_RUN_TIMEOUT_MS,
  agentRunTimeoutMs,
  createRunAbortSignal,
  readRunAbortReason,
} from "../../src/lib/ai/run-timeout";

describe("createRunAbortSignal", () => {
  it("aborts when the incoming request is aborted", () => {
    const request = new AbortController();
    const signal = createRunAbortSignal(request.signal, 10_000);

    request.abort();

    expect(signal.aborted).toBe(true);
    expect(readRunAbortReason(signal)).toEqual({ code: "request-aborted" });
  });

  it("aborts when the runtime exceeds its deadline", async () => {
    const request = new AbortController();
    const signal = createRunAbortSignal(request.signal, 5);

    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(signal.aborted).toBe(true);
    expect(readRunAbortReason(signal)).toEqual({
      code: "runtime-timeout",
      timeoutMs: 5,
    });
  });

  it("defaults to a long desktop-friendly agent timeout", () => {
    expect(agentRunTimeoutMs()).toBe(DEFAULT_AGENT_RUN_TIMEOUT_MS);
    expect(DEFAULT_AGENT_RUN_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });
});
