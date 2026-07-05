import { rmSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { TrialState } from "../../src/lib/license/trial";

const { tmpHome } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  return { tmpHome: fs.mkdtempSync(path.join(os.tmpdir(), "inkpress-trial-")) };
});

vi.mock("@/lib/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paths")>();
  return { ...actual, inkpressHomeDir: () => tmpHome };
});

const { evaluateTrial } = await import("../../src/lib/license/trial");

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  try {
    rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function trialState(overrides: Partial<TrialState> = {}): TrialState {
  return {
    deviceIdHash: "device",
    trialStartedAt: "2026-07-01T00:00:00.000Z",
    trialExpiresAt: "2026-07-08T00:00:00.000Z",
    trialLastCheckedAt: "2026-07-01T00:00:00.000Z",
    serverRegisteredAt: null,
    serverSyncedAt: null,
    status: "TRIAL",
    ...overrides,
  };
}

describe("license trial evaluation", () => {
  it("keeps a locally expired trial expired even if the wall clock moves back", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));

    const result = evaluateTrial(trialState({ status: "EXPIRED" }));

    expect(result.inTrial).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.remainingMs).toBe(0);
  });

  it("treats malformed trial timestamps as tampering instead of allowing trial", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));

    const result = evaluateTrial(
      trialState({
        trialExpiresAt: "not-a-date",
        trialLastCheckedAt: "also-not-a-date",
      })
    );

    expect(result.inTrial).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.tampered).toBe(true);
    expect(result.remainingMs).toBe(0);
  });
});
