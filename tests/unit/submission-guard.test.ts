import { describe, expect, it } from "vitest";
import { SubmissionGuard } from "../../src/lib/ai/submission-guard";

describe("SubmissionGuard", () => {
  it("rejects repeated submission until the current one is released", () => {
    const guard = new SubmissionGuard();

    expect(guard.acquire()).toBe(true);
    expect(guard.acquire()).toBe(false);

    guard.release();
    expect(guard.acquire()).toBe(true);
  });
});
