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

export type MergeRelation = "new" | "truncate" | "append" | "disjoint";

/**
 * 判定前端消息列表相对 DB 历史的关系，驱动 mergeAndPersistMessages 的合并策略。纯函数，便于单测。
 *
 * - new：DB 为空（新会话或已清空）。
 * - truncate：前端列表是 DB 的「连续前缀」——从第 1 条起逐个 id 相等，直到前端结束
 *   （前端可短于或等于 DB）。覆盖 rerun/regenerate（截断尾部）与完全一致（幂等重写）。
 *   必须是「连续前缀」：仅末条 id 命中 DB 不足以判定——否则页面级导航 remount 后前端只持
 *   最近若干条时，会把 DB 更早的历史误当截断删掉（F-001 回归根因）。
 * - append：前端末条不在 DB，但前端与 DB 存在 id 交集 → 以「前端最后一条在 DB 的消息」
 *   为分歧点，用 DB 前缀补全被分页/remount 截掉的历史。
 * - disjoint：前端与 DB 无任何 id 交集（异常）。
 *
 * 无 id 的消息（id 为空）永不匹配，因此不会把含空 id 的列表误判为 truncate。
 */
export function detectRelation(
  uiMessages: UIMessage[],
  dbMessages: UIMessage[]
): MergeRelation {
  if (dbMessages.length === 0) return "new";
  const isPrefix =
    uiMessages.length <= dbMessages.length &&
    uiMessages.every((m, i) => !!m.id && m.id === dbMessages[i].id);
  if (isPrefix) return "truncate";
  const dbIds = new Set(dbMessages.map((m) => m.id));
  return uiMessages.some((m) => !!m.id && dbIds.has(m.id)) ? "append" : "disjoint";
}

/**
 * 合并前端消息与 DB 历史，避免分页/remount 导致的消息丢失。
 *
 * 问题背景：WritingAssistant 因页面级导航重挂载时只从 DB 分页加载最近若干条消息，
 * 下次发送/重跑时前端只传这些消息。若后端用 delete-all-recreate 语义盲目覆盖，
 * 被分页出去的旧消息会被永久删除。
 *
 * 策略（由 detectRelation 驱动）：
 * - new / disjoint：直接写入前端消息（disjoint 为异常保守路径，不丢数据）。
 * - truncate（前端是 DB 连续前缀，含 rerun/regenerate/幂等）：前端列表权威，截断尾部。
 * - append：前端末条不在 DB → 找分歧点（前端最后一条存在于 DB 的消息），用 DB 补全前缀。
 *
 * 返回合并后的完整消息列表，供后续 originalMessages / prepareAgentContext 使用。
 * 入口 POST 与各 onFinish 均走此函数：基于「最新 DB」合并而非盲目覆盖，使并发轮次
 * 不会互相丢失对方已持久化的回复。
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

  const relation = detectRelation(uiMessages, dbMessages);

  if (relation !== "append") {
    // new / truncate / disjoint：前端列表权威（truncate 截断尾部，new/disjoint 直写）
    await saveAgentMessages(sessionId, uiMessages);
    return uiMessages;
  }

  // append：找分歧点（前端最后一条在 DB 的消息），用 DB 补全前缀
  const dbIds = new Set(dbMessages.map((m) => m.id));
  let divergence = -1;
  for (let i = uiMessages.length - 1; i >= 0; i--) {
    if (uiMessages[i].id && dbIds.has(uiMessages[i].id)) {
      divergence = i;
      break;
    }
  }
  if (divergence === -1) {
    // 理论不可达（detectRelation 已保证 append 有交集）；防御性兜底，保守不丢数据
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