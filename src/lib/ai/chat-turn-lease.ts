import { prisma } from "@/lib/db";

const DEFAULT_TURN_LEASE_TTL_MS = 2 * 60_000;

type LeaseInput = {
  sessionId: string;
  generation: number;
  turnId: string;
};

type AcquireTurnLeaseInput = LeaseInput & {
  now?: Date;
  ttlMs?: number;
};

export type AcquireTurnLeaseResult =
  | { ok: true; turnId: string; expiresAt: Date }
  | { ok: false; status: 409; reason: "active-turn" | "stale-session" };

export async function acquireTurnLease({
  sessionId,
  generation,
  turnId,
  now = new Date(),
  ttlMs = DEFAULT_TURN_LEASE_TTL_MS,
}: AcquireTurnLeaseInput): Promise<AcquireTurnLeaseResult> {
  const expiresAt = new Date(now.getTime() + ttlMs);
  return prisma.$transaction(async (tx) => {
    const emptyClaim = await tx.agentChatSession.updateMany({
      where: {
        id: sessionId,
        generation,
        activeTurnId: null,
      },
      data: {
        activeTurnId: turnId,
        activeTurnExpiresAt: expiresAt,
      },
    });
    if (emptyClaim.count === 1) return { ok: true as const, turnId, expiresAt };

    const expiredClaim = await tx.agentChatSession.updateMany({
      where: {
        id: sessionId,
        generation,
        OR: [{ activeTurnExpiresAt: { lt: now } }],
      },
      data: {
        activeTurnId: turnId,
        activeTurnExpiresAt: expiresAt,
        claudeAgentSessionStatus: "interrupted",
        claudeAgentInterruptedAt: now,
      },
    });
    if (expiredClaim.count === 1) return { ok: true as const, turnId, expiresAt };

    const current = await tx.agentChatSession.findUnique({
      where: { id: sessionId },
      select: { generation: true },
    });
    if (!current || current.generation !== generation) {
      return {
        ok: false as const,
        status: 409 as const,
        reason: "stale-session" as const,
      };
    }
    return {
      ok: false as const,
      status: 409 as const,
      reason: "active-turn" as const,
    };
  });
}

export async function releaseTurnLease(
  input: LeaseInput
): Promise<{ ignored: boolean }> {
  const update = await prisma.agentChatSession.updateMany({
    where: {
      id: input.sessionId,
      generation: input.generation,
      activeTurnId: input.turnId,
    },
    data: {
      activeTurnId: null,
      activeTurnExpiresAt: null,
    },
  });
  return { ignored: update.count === 0 };
}

export async function finalizeTurnLease(
  input: LeaseInput & { data: Record<string, unknown> }
): Promise<{ ignored: boolean }> {
  const update = await prisma.agentChatSession.updateMany({
    where: {
      id: input.sessionId,
      generation: input.generation,
      activeTurnId: input.turnId,
    },
    data: {
      ...input.data,
      activeTurnId: null,
      activeTurnExpiresAt: null,
    },
  });
  return { ignored: update.count === 0 };
}
