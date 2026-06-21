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

export async function loadAgentMessages(sessionId: string): Promise<UIMessage[]> {
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
