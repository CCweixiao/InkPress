import type { UIMessage } from "ai";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("ai.chat-persistence");

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

/**
 * 合并前端消息与 DB 历史，避免分页/remount 导致的消息丢失。
 *
 * 问题背景：WritingAssistant 组件因 tab 切换（条件渲染）remount 时只从 DB 分页加载 10 条消息，
 * 下次发送时前端只传这些消息。若后端用 delete-all-recreate 语义，被分页出去的旧消息会被永久删除。
 *
 * 策略：
 * - 新会话或 DB 已空：直接写入前端消息。
 * - truncate 场景（rerun/regenerate）：前端最后一条消息 ID 在 DB 中存在 → 前端列表是权威子集，截断。
 * - append 场景：前端最后一条消息 ID 不在 DB 中 → 找分歧点（前端最后一条存在于 DB 的消息），用 DB 补全前缀。
 * - 无交集（异常）：直接写入前端消息，保守不丢数据。
 *
 * 返回合并后的完整消息列表，供后续 originalMessages / prepareAgentContext 使用。
 */
export async function mergeAndPersistMessages(
  sessionId: string,
  uiMessages: UIMessage[]
): Promise<UIMessage[]> {
  const dbMessages = await loadAllAgentMessages(sessionId);

  log.debug(
    {
      sessionId,
      frontendCount: uiMessages.length,
      dbCount: dbMessages.length,
    },
    "mergeAndPersistMessages 输入"
  );
  if (dbMessages.length === 0) {
    // 新会话或已清空：直接写入前端消息
    await saveAgentMessages(sessionId, uiMessages);
    return uiMessages;
  }

  const dbIds = new Set(dbMessages.map((m) => m.id));
  const lastFrontendId = uiMessages[uiMessages.length - 1]?.id;

  if (lastFrontendId && dbIds.has(lastFrontendId)) {
    // truncate/rerun/regenerate：前端消息是 DB 的前缀子集 → 截断
    await saveAgentMessages(sessionId, uiMessages);
    return uiMessages;
  }

  // append：找分歧点（前端最后一条在 DB 中的消息），用 DB 补全前缀
  let divergence = -1;
  for (let i = uiMessages.length - 1; i >= 0; i--) {
    if (dbIds.has(uiMessages[i].id)) {
      divergence = i;
      break;
    }
  }
  if (divergence === -1) {
    // 无交集（异常）：直接写入前端消息
    await saveAgentMessages(sessionId, uiMessages);
    return uiMessages;
  }

  const dbDivIdx = dbMessages.findIndex((m) => m.id === uiMessages[divergence].id);
  const merged = [
    ...dbMessages.slice(0, dbDivIdx + 1),
    ...uiMessages.slice(divergence + 1),
  ];
  log.debug(
    {
      sessionId,
      branch: "append",
      divergence,
      dbDivIdx,
      mergedCount: merged.length,
    },
    "mergeAndPersistMessages 合并结果"
  );
  await saveAgentMessages(sessionId, merged);
  return merged;
}