import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abortApproval,
  pendingApprovalCount,
  registerPendingApproval,
  resolveApproval,
} from "../../src/lib/ai/pending-approvals";

describe("pending tool approval lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const id of ["pre-abort", "timeout", "manual", "resolved", "duplicate", "cleanup-order"]) {
      abortApproval(id);
    }
  });

  it("settles immediately for a pre-aborted signal instead of leaving a pending promise", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      registerPendingApproval("pre-abort", "web_fetch", {
        signal: controller.signal,
        timeoutMs: 1_000,
      })
    ).resolves.toBe("deny");
    expect(pendingApprovalCount()).toBe(0);
  });

  it("expires registered approvals on timeout and removes them from memory", async () => {
    vi.useFakeTimers();
    const onExpire = vi.fn().mockResolvedValue(undefined);

    const promise = registerPendingApproval("timeout", "web_fetch", {
      timeoutMs: 100,
      onExpire,
    });
    expect(pendingApprovalCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toBe("deny");
    expect(onExpire).toHaveBeenCalledOnce();
    expect(pendingApprovalCount()).toBe(0);
  });

  it("settles timeout before async cleanup finishes", async () => {
    vi.useFakeTimers();
    const order: string[] = [];

    const promise = registerPendingApproval("cleanup-order", "web_fetch", {
      timeoutMs: 100,
      onExpire: async () => {
        order.push("cleanup-start");
        await Promise.resolve();
        order.push("cleanup-done");
      },
    }).then((decision) => {
      order.push(`resolved:${decision}`);
      return decision;
    });

    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toBe("deny");
    expect(order).toEqual(["cleanup-start", "resolved:deny", "cleanup-done"]);
  });

  it("aborts registered approvals as deny and ignores later resolutions", async () => {
    const controller = new AbortController();
    const promise = registerPendingApproval("manual", "web_fetch", {
      signal: controller.signal,
      timeoutMs: 10_000,
    });

    controller.abort();

    await expect(promise).resolves.toBe("deny");
    expect(resolveApproval("manual", "allow")).toBe(false);
    expect(pendingApprovalCount()).toBe(0);
  });

  it("denies an existing pending promise before replacing the same grant id", async () => {
    const first = registerPendingApproval("duplicate", "web_fetch", {
      timeoutMs: 10_000,
    });
    const second = registerPendingApproval("duplicate", "web_fetch", {
      timeoutMs: 10_000,
    });

    await expect(first).resolves.toBe("deny");
    expect(pendingApprovalCount()).toBe(1);
    expect(resolveApproval("duplicate", "allow")).toBe(true);
    await expect(second).resolves.toBe("allow");
    expect(pendingApprovalCount()).toBe(0);
  });
});
