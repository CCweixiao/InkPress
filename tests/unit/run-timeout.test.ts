import { describe, expect, it } from "vitest";
import { createRunAbortSignal } from "../../src/lib/ai/run-timeout";

describe("createRunAbortSignal", () => {
  it("aborts when the incoming request is aborted", () => {
    const request = new AbortController();
    const signal = createRunAbortSignal(request.signal, 10_000);

    request.abort();

    expect(signal.aborted).toBe(true);
  });

  it("aborts when the runtime exceeds its deadline", async () => {
    const request = new AbortController();
    const signal = createRunAbortSignal(request.signal, 5);

    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(signal.aborted).toBe(true);
  });
});
