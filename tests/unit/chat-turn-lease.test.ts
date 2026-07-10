import { beforeEach, describe, expect, it, vi } from "vitest";

type SessionRow = {
  generation: number;
  activeTurnId: string | null;
  activeTurnExpiresAt: Date | null;
  claudeAgentSessionStatus: string;
};

const mockState = vi.hoisted(() => {
  const sessions = new Map<string, SessionRow>();
  const tx = {
    agentChatSession: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => sessions.get(where.id) ?? null
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id: string;
            generation?: number;
            activeTurnId?: string | null;
            OR?: Array<{
              activeTurnId?: null;
              activeTurnExpiresAt?: { lt?: Date; lte?: Date };
            }>;
          };
          data: Partial<SessionRow>;
        }) => {
          const current = sessions.get(where.id);
          if (!current) return { count: 0 };
          if (where.generation !== undefined && current.generation !== where.generation) {
            return { count: 0 };
          }
          if ("activeTurnId" in where && current.activeTurnId !== where.activeTurnId) {
            return { count: 0 };
          }
          if (where.OR) {
            const matches = where.OR.some((clause) => {
              if ("activeTurnId" in clause && clause.activeTurnId === null) {
                return current.activeTurnId === null;
              }
              const expiresAt = clause.activeTurnExpiresAt?.lt ?? clause.activeTurnExpiresAt?.lte;
              return !!expiresAt && !!current.activeTurnExpiresAt && current.activeTurnExpiresAt < expiresAt;
            });
            if (!matches) return { count: 0 };
          }
          sessions.set(where.id, { ...current, ...data });
          return { count: 1 };
        }
      ),
    },
  };
  return {
    sessions,
    prismaMock: {
      agentChatSession: tx.agentChatSession,
      $transaction: vi.fn(async (fn: (arg: typeof tx) => unknown) => fn(tx)),
    },
  };
});

vi.mock("@/lib/db", () => ({
  prisma: mockState.prismaMock,
}));

import {
  acquireTurnLease,
  finalizeTurnLease,
  releaseTurnLease,
} from "@/lib/ai/chat-turn-lease";

describe("chat turn lease", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockState.sessions.clear();
  });

  it("rejects a second active turn for the same session", async () => {
    mockState.sessions.set("s1", {
      generation: 1,
      activeTurnId: null,
      activeTurnExpiresAt: null,
      claudeAgentSessionStatus: "ready",
    });
    const now = new Date("2026-07-10T00:00:00.000Z");

    const first = await acquireTurnLease({
      sessionId: "s1",
      generation: 1,
      turnId: "turn-1",
      now,
      ttlMs: 60_000,
    });
    const second = await acquireTurnLease({
      sessionId: "s1",
      generation: 1,
      turnId: "turn-2",
      now: new Date(now.getTime() + 1000),
      ttlMs: 60_000,
    });

    expect(first).toMatchObject({ ok: true, turnId: "turn-1" });
    expect(second).toEqual({ ok: false, status: 409, reason: "active-turn" });
  });

  it("allows a new turn to steal an expired lease", async () => {
    mockState.sessions.set("s1", {
      generation: 1,
      activeTurnId: "old-turn",
      activeTurnExpiresAt: new Date("2026-07-10T00:00:00.000Z"),
      claudeAgentSessionStatus: "running",
    });

    const result = await acquireTurnLease({
      sessionId: "s1",
      generation: 1,
      turnId: "new-turn",
      now: new Date("2026-07-10T00:01:00.000Z"),
      ttlMs: 60_000,
    });

    expect(result).toMatchObject({ ok: true, turnId: "new-turn" });
    expect(mockState.sessions.get("s1")).toMatchObject({
      activeTurnId: "new-turn",
      claudeAgentSessionStatus: "interrupted",
    });
  });

  it("marks an expired stolen running turn as interrupted before release", async () => {
    mockState.sessions.set("s1", {
      generation: 1,
      activeTurnId: "old-turn",
      activeTurnExpiresAt: new Date("2026-07-10T00:00:00.000Z"),
      claudeAgentSessionStatus: "running",
    });

    const result = await acquireTurnLease({
      sessionId: "s1",
      generation: 1,
      turnId: "local-short-turn",
      now: new Date("2026-07-10T00:01:00.000Z"),
      ttlMs: 60_000,
    });
    await releaseTurnLease({
      sessionId: "s1",
      generation: 1,
      turnId: "local-short-turn",
    });

    expect(result).toMatchObject({ ok: true });
    expect(mockState.sessions.get("s1")).toMatchObject({
      activeTurnId: null,
      activeTurnExpiresAt: null,
      claudeAgentSessionStatus: "interrupted",
    });
  });

  it("acquire only claims the lease and does not change business status", async () => {
    mockState.sessions.set("s1", {
      generation: 1,
      activeTurnId: null,
      activeTurnExpiresAt: null,
      claudeAgentSessionStatus: "ready",
    });

    await acquireTurnLease({
      sessionId: "s1",
      generation: 1,
      turnId: "turn-1",
      now: new Date("2026-07-10T00:00:00.000Z"),
      ttlMs: 60_000,
    });

    expect(mockState.sessions.get("s1")).toMatchObject({
      activeTurnId: "turn-1",
      claudeAgentSessionStatus: "ready",
    });
  });

  it("release only clears the holder turn", async () => {
    mockState.sessions.set("s1", {
      generation: 1,
      activeTurnId: "holder",
      activeTurnExpiresAt: new Date("2026-07-10T00:01:00.000Z"),
      claudeAgentSessionStatus: "running",
    });

    await releaseTurnLease({ sessionId: "s1", generation: 1, turnId: "other" });
    expect(mockState.sessions.get("s1")?.activeTurnId).toBe("holder");

    await releaseTurnLease({ sessionId: "s1", generation: 1, turnId: "holder" });
    expect(mockState.sessions.get("s1")).toMatchObject({
      activeTurnId: null,
      activeTurnExpiresAt: null,
    });
  });

  it("finalize only applies status and clears the holder turn", async () => {
    mockState.sessions.set("s1", {
      generation: 1,
      activeTurnId: "holder",
      activeTurnExpiresAt: new Date("2026-07-10T00:01:00.000Z"),
      claudeAgentSessionStatus: "running",
    });

    const ignored = await finalizeTurnLease({
      sessionId: "s1",
      generation: 1,
      turnId: "other",
      data: { claudeAgentSessionStatus: "ready" },
    });
    expect(ignored).toEqual({ ignored: true });
    expect(mockState.sessions.get("s1")?.claudeAgentSessionStatus).toBe("running");

    const applied = await finalizeTurnLease({
      sessionId: "s1",
      generation: 1,
      turnId: "holder",
      data: { claudeAgentSessionStatus: "ready" },
    });
    expect(applied).toEqual({ ignored: false });
    expect(mockState.sessions.get("s1")).toMatchObject({
      activeTurnId: null,
      activeTurnExpiresAt: null,
      claudeAgentSessionStatus: "ready",
    });
  });
});
