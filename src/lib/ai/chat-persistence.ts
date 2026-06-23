import type { UIMessage } from "ai";
import { prisma } from "@/lib/db";

export type AgentTarget =
  | { kind: "article"; id: string }
  | { kind: "technical-document"; id: string };

export async function getOrCreateAgentSession(target: AgentTarget | string) {
  const normalized: AgentTarget =
    typeof target === "string" ? { kind: "article", id: target } : target;
  if (normalized.kind === "article") {
    return prisma.agentChatSession.upsert({
      where: { articleId: normalized.id },
      update: { targetKind: "article" },
      create: { articleId: normalized.id, targetKind: "article" },
    });
  }
  return prisma.agentChatSession.upsert({
    where: { technicalDocumentId: normalized.id },
    update: { targetKind: "technical-document" },
    create: {
      technicalDocumentId: normalized.id,
      targetKind: "technical-document",
    },
  });
}

/**
 * 加载会话消息（游标分页）。
 * - 不传 beforePosition：取最近 limit 条（position 最高的）。
 * - 传 beforePosition：取严格更早的 limit 条。
 * take limit+1 用于判断 hasMore（多取一条作哨兵），返回 oldestPosition 供下次游标。
 * 返回的 messages 已按 position 升序（最旧→最新），方便直接 prepend 或展示。
 */
export async function loadAgentMessages(
  sessionId: string,
  opts: { limit?: number; beforePosition?: number } = {}
): Promise<{
  messages: UIMessage[];
  hasMore: boolean;
  oldestPosition: number | null;
}> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const rows = await prisma.agentChatMessage.findMany({
    where: {
      sessionId,
      ...(opts.beforePosition !== undefined
        ? { position: { lt: opts.beforePosition } }
        : {}),
    },
    orderBy: { position: "desc" },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  // 取最新的 limit 条（rows 已 desc），丢弃多余哨兵；再反转为升序展示
  const pageRows = (hasMore ? rows.slice(0, limit) : rows).slice().reverse();
  return {
    messages: pageRows.map((row) => ({
      id: row.id,
      role: row.role as UIMessage["role"],
      parts: JSON.parse(row.partsJson) as UIMessage["parts"],
      ...(row.metadataJson ? { metadata: JSON.parse(row.metadataJson) } : {}),
    })),
    hasMore,
    oldestPosition: pageRows.length ? pageRows[0].position : null,
  };
}

/**
 * 加载会话全部消息（按 position 升序），用于 /compact 全量压缩。
 * 与 loadAgentMessages 不同：不分页、不带哨兵，返回完整历史。
 */
export async function loadAllAgentMessages(sessionId: string): Promise<UIMessage[]> {
  const rows = await prisma.agentChatMessage.findMany({
    where: { sessionId },
    orderBy: { position: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: JSON.parse(row.partsJson) as UIMessage["parts"],
    ...(row.metadataJson ? { metadata: JSON.parse(row.metadataJson) } : {}),
  }));
}

export async function saveAgentMessages(sessionId: string, messages: UIMessage[]) {
  await prisma.$transaction([
    prisma.agentChatMessage.deleteMany({ where: { sessionId } }),
    ...messages.map((message, position) =>
      prisma.agentChatMessage.create({
        data: {
          id: message.id || crypto.randomUUID(),
          sessionId,
          role: message.role,
          partsJson: JSON.stringify(message.parts ?? []),
          metadataJson:
            "metadata" in message && message.metadata !== undefined
              ? JSON.stringify(message.metadata)
              : null,
          position,
        },
      })
    ),
  ]);
}