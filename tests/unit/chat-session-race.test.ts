import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";

const mockState = vi.hoisted(() => {
  const sessions = new Map<string, number>();
  const messages = new Map<string, UIMessage[]>();

  const agentChatMessage = {
    findMany: vi.fn(async ({ where }: { where: { sessionId: string } }) => {
      return (messages.get(where.sessionId) ?? []).map(
        (message, position) => ({
          id: message.id,
          role: message.role,
          partsJson: JSON.stringify(message.parts ?? []),
          metadataJson:
            "metadata" in message && message.metadata !== undefined
              ? JSON.stringify(message.metadata)
              : null,
          position,
        })
      );
    }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    update: vi.fn(async () => ({})),
    create: vi.fn(
      async ({
        data,
      }: {
        data: {
          sessionId: string;
          id: string;
          role: UIMessage["role"];
          partsJson: string;
        };
      }) => {
        const current = messages.get(data.sessionId) ?? [];
        current.push({
          id: data.id,
          role: data.role,
          parts: JSON.parse(data.partsJson),
        } as UIMessage);
        messages.set(data.sessionId, current);
        return data;
      }
    ),
  };

  const agentUsageTurn = {
    upsert: vi.fn(async () => ({})),
  };

  const prismaMock = {
    agentChatSession: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => ({
          generation: sessions.get(where.id) ?? 0,
        })
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { generation?: { increment: number } };
        }) => {
          if (data.generation?.increment) {
            sessions.set(
              where.id,
              (sessions.get(where.id) ?? 0) + data.generation.increment
            );
          }
          return {};
        }
      ),
    },
    agentChatMessage,
    agentUsageTurn,
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") {
        return arg({
          agentChatSession: prismaMock.agentChatSession,
          agentChatMessage,
          agentUsageTurn,
        });
      }
      return Promise.all(arg as Array<Promise<unknown>>);
    }),
  };

  return { agentChatMessage, agentUsageTurn, messages, prismaMock, sessions };
});

vi.mock("@/lib/db", () => ({
  prisma: mockState.prismaMock,
}));

vi.mock("@/lib/logger", () => ({
  moduleLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  captureSessionGeneration,
  clearSession,
  computeMergedMessages,
  isSessionGenerationCurrent,
  mergeAndPersistMessagesIfGenerationCurrent,
} from "@/lib/ai/chat-persistence";
import { upsertUsageTurnIfSessionGenerationCurrent } from "@/lib/ai/usage-ledger";

const msg = (id: string, role: UIMessage["role"] = "user"): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text: id }],
});

const usageSummary = {
  inputTokens: 1,
  outputTokens: 2,
  cacheReadInputTokens: 3,
  cacheCreationInputTokens: 4,
  totalTokens: 10,
  costUsd: 0.01,
  status: "completed" as const,
  source: "sdk-result" as const,
  modelUsage: {},
};

describe("chat session race guards", () => {
  beforeEach(() => {
    mockState.sessions.clear();
    mockState.messages.clear();
    vi.clearAllMocks();
  });

  it("rejects disjoint client history while persisted history exists", () => {
    const result = computeMergedMessages(
      [{ id: "old", role: "assistant", parts: [] }] as UIMessage[],
      [{ id: "new", role: "user", parts: [] }] as UIMessage[]
    );
    expect(result.conflict).toBe("initializing-client");
  });

  it("ignores an old turn after clear", async () => {
    const id = "race-test";
    const generation = await captureSessionGeneration(id);

    await clearSession(id);

    expect(await isSessionGenerationCurrent(id, generation)).toBe(false);
  });

  it("does not write messages for stale generation", async () => {
    mockState.sessions.set("s1", 2);

    const result = await mergeAndPersistMessagesIfGenerationCurrent("s1", 1, [
      msg("new"),
    ]);

    expect(result).toEqual({ ignored: true });
    expect(mockState.agentChatMessage.findMany).not.toHaveBeenCalled();
    expect(mockState.agentChatMessage.create).not.toHaveBeenCalled();
    expect(mockState.agentChatMessage.update).not.toHaveBeenCalled();
    expect(mockState.agentChatMessage.deleteMany).not.toHaveBeenCalled();
  });

  it("writes messages for current generation", async () => {
    mockState.sessions.set("s1", 2);

    const result = await mergeAndPersistMessagesIfGenerationCurrent("s1", 2, [
      msg("new"),
    ]);

    expect(result.ignored).toBe(false);
    expect(result.messages?.map((message) => message.id)).toEqual(["new"]);
    expect(mockState.prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(mockState.agentChatMessage.findMany).toHaveBeenCalled();
    expect(mockState.agentChatMessage.create).toHaveBeenCalledTimes(1);
  });

  it("returns conflict without writing when transaction sees disjoint persisted history", async () => {
    mockState.sessions.set("s1", 2);
    mockState.messages.set("s1", [msg("persisted", "assistant")]);

    const result = await mergeAndPersistMessagesIfGenerationCurrent("s1", 2, [
      msg("incoming", "user"),
    ]);

    expect(result).toEqual({
      ignored: false,
      conflict: "initializing-client",
      messages: [msg("persisted", "assistant")],
    });
    expect(mockState.agentChatMessage.deleteMany).not.toHaveBeenCalled();
    expect(mockState.agentChatMessage.create).not.toHaveBeenCalled();
    expect(mockState.agentChatMessage.update).not.toHaveBeenCalled();
  });

  it("does not upsert usage for stale generation", async () => {
    mockState.sessions.set("s1", 2);

    const result = await upsertUsageTurnIfSessionGenerationCurrent(
      {
        sessionId: "s1",
        turnId: "t1",
        targetKind: "article",
        targetId: "a1",
      },
      usageSummary,
      1
    );

    expect(result).toEqual({ ignored: true });
    expect(mockState.agentUsageTurn.upsert).not.toHaveBeenCalled();
  });

  it("upserts usage for current generation", async () => {
    mockState.sessions.set("s1", 2);

    const result = await upsertUsageTurnIfSessionGenerationCurrent(
      {
        sessionId: "s1",
        turnId: "t1",
        targetKind: "article",
        targetId: "a1",
      },
      usageSummary,
      2
    );

    expect(result).toEqual({ ignored: false });
    expect(mockState.agentUsageTurn.upsert).toHaveBeenCalledTimes(1);
    expect(mockState.agentUsageTurn.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId_turnId: { sessionId: "s1", turnId: "t1" } },
      })
    );
  });
});
