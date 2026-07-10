import type { UIMessage } from "ai";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("ai.chat-persistence");

/**
 * 读/写 helper 的客户端约束：结构化地只要求相关 Prisma 委托。
 * 全局 prisma 与交互式事务的 tx 客户端都满足，故同一份 helper 既可独立调用、也可绑定到同一 tx。
 */
type DbClient = Pick<typeof prisma, "agentChatMessage" | "agentChatSession">;

export type AgentTarget =
  | { kind: "article"; id: string }
  | { kind: "technical-document"; id: string };

type AgentChatMessageRow = {
  id: string;
  role: string;
  partsJson: string;
  metadataJson: string | null;
  position: number;
};

/**
 * 规范化从 DB 加载的 part 状态。
 *
 * 客户端断连时 AI SDK 的 createUIMessageStream 通过 cancel() 触发 onFinish，
 * 正在执行的工具 part 可能以 input-streaming / input-available 状态被持久化。
 * 重新加载后 isPartStreaming 判定为"运行中"→ 永久 spinner。
 * 历史消息的工具调用不可能仍在运行，统一强制为 output-available。
 */
export function normalizeLoadedParts(parts: UIMessage["parts"]): UIMessage["parts"] {
  const raw = parts as Record<string, unknown>[];
  let changed = false;
  const normalized = raw.map((part) => {
    const type = part.type;
    const isTool =
      type === "dynamic-tool" ||
      (typeof type === "string" && type.startsWith("tool-"));
    if (!isTool) return part;
    const state = part.state;
    if (state === "input-streaming" || state === "input-available") {
      changed = true;
      return { ...part, state: "output-available" as const };
    }
    return part;
  });
  return changed ? (normalized as UIMessage["parts"]) : parts;
}

/** 行 → UIMessage（统一映射口径，避免各处重复 JSON.parse 逻辑）。 */
function rowToUIMessage(row: AgentChatMessageRow): UIMessage {
  return {
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: normalizeLoadedParts(
      JSON.parse(row.partsJson) as UIMessage["parts"]
    ),
    ...(row.metadataJson ? { metadata: JSON.parse(row.metadataJson) } : {}),
  };
}

/** 加载会话全部消息（升序），绑定到传入的客户端（全局 prisma 或事务 tx）。 */
async function loadAllWithin(
  client: DbClient,
  sessionId: string
): Promise<UIMessage[]> {
  const rows = await client.agentChatMessage.findMany({
    where: { sessionId },
    orderBy: { position: "asc" },
  });
  return rows.map(rowToUIMessage);
}

/** 序列化一条 UIMessage 为目标行（position 由调用方按下标赋值）。 */
function toDesiredRow(message: UIMessage, position: number) {
  return {
    id: message.id || crypto.randomUUID(),
    role: message.role,
    partsJson: JSON.stringify(message.parts ?? []),
    metadataJson:
      "metadata" in message && message.metadata !== undefined
        ? JSON.stringify(message.metadata)
        : null,
    position,
  };
}

/**
 * 增量对账写入会话消息（绑定到传入的客户端：全局 prisma 或事务 tx）。
 *
 * 相比早期的「整表 deleteMany + 全量 create」，按 id 对账只写实际变化的行：
 * - 删除：DB 中存在但目标列表已无的 id。
 * - 更新：id 命中但 partsJson/metadataJson/position 任一变化（如流式累积、rerun 改写）。
 * - 新建：目标中存在但 DB 没有的 id。
 * - 跳过：完全一致的行（绝大多数旧消息），消除长会话每轮的写放大。
 *
 * 顺序安全：computeMerged 从不重排已存活消息（truncate/append 都保持前缀原位，新消息只占用
 * 删除后腾出的尾部 position），因此「先删除、再 upsert」不会触发 @@unique([sessionId, position])
 * 的瞬时冲突。
 */
async function saveWithin(
  client: DbClient,
  sessionId: string,
  messages: UIMessage[]
): Promise<void> {
  const existingRows = await client.agentChatMessage.findMany({
    where: { sessionId },
    select: { id: true, partsJson: true, metadataJson: true, position: true },
  });
  const existingById = new Map(existingRows.map((row) => [row.id, row]));

  const desired = messages.map((message, position) =>
    toDesiredRow(message, position)
  );
  const desiredIds = new Set(desired.map((row) => row.id));

  // 1) 删除不再存在的行（先删除，腾出可能被新消息复用的 position）。
  const toDelete = existingRows
    .filter((row) => !desiredIds.has(row.id))
    .map((row) => row.id);
  if (toDelete.length > 0) {
    await client.agentChatMessage.deleteMany({
      where: { sessionId, id: { in: toDelete } },
    });
  }

  // 2) 逐条 upsert，跳过未变化的行。
  for (const row of desired) {
    const prev = existingById.get(row.id);
    if (
      prev &&
      prev.position === row.position &&
      prev.partsJson === row.partsJson &&
      prev.metadataJson === row.metadataJson
    ) {
      continue; // 完全一致，无需写
    }
    if (prev) {
      await client.agentChatMessage.update({
        where: { id: row.id },
        data: {
          role: row.role,
          partsJson: row.partsJson,
          metadataJson: row.metadataJson,
          position: row.position,
        },
      });
    } else {
      await client.agentChatMessage.create({
        data: {
          id: row.id,
          sessionId,
          role: row.role,
          partsJson: row.partsJson,
          metadataJson: row.metadataJson,
          position: row.position,
        },
      });
    }
  }
}

export async function getOrCreateAgentSession(target: AgentTarget | string) {
  const normalized: AgentTarget =
    typeof target === "string" ? { kind: "article", id: target } : target;
  if (normalized.kind === "article") {
    return prisma.agentChatSession.upsert({
      where: { articleId: normalized.id },
      update: { targetKind: "article", runtime: "claude-agent" },
      create: {
        articleId: normalized.id,
        targetKind: "article",
        runtime: "claude-agent",
      },
    });
  }
  return prisma.agentChatSession.upsert({
    where: { technicalDocumentId: normalized.id },
    update: { targetKind: "technical-document", runtime: "claude-agent" },
    create: {
      technicalDocumentId: normalized.id,
      targetKind: "technical-document",
      runtime: "claude-agent",
    },
  });
}

/** 仅读取目标对应的 Agent 会话；打开页面/刷新历史时不制造空会话记录。 */
export async function findAgentSession(target: AgentTarget) {
  return prisma.agentChatSession.findFirst({
    where:
      target.kind === "article"
        ? { articleId: target.id }
        : { technicalDocumentId: target.id },
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
    messages: pageRows.map(rowToUIMessage),
    hasMore,
    oldestPosition: pageRows.length ? pageRows[0].position : null,
  };
}

/**
 * 加载会话全部消息（按 position 升序），用于 /compact 全量压缩。
 * 与 loadAgentMessages 不同：不分页、不带哨兵，返回完整历史。
 */
export async function loadAllAgentMessages(sessionId: string): Promise<UIMessage[]> {
  return loadAllWithin(prisma, sessionId);
}

export async function saveAgentMessages(sessionId: string, messages: UIMessage[]) {
  await prisma.$transaction((tx) => saveWithin(tx, sessionId, messages));
}

export type MergeRelation = "new" | "truncate" | "append" | "disjoint";

/** Conservative merge result used by initializing clients. */
export function computeMergedMessages(
  persisted: UIMessage[],
  incoming: UIMessage[]
): { messages: UIMessage[]; conflict?: "initializing-client" } {
  const relation = detectRelation(incoming, persisted);
  if (relation === "disjoint" && persisted.length > 0 && incoming.length > 0) {
    return { messages: persisted, conflict: "initializing-client" };
  }
  return { messages: computeMerged(relation, incoming, persisted) };
}

/** Merge a refreshed newest page into already loaded history without dropping it. */
export { mergeFinishedMessages } from "@/lib/ai/chat-message-merge";

const sessionGenerations = new Map<string, number>();
export async function captureSessionGeneration(sessionId: string): Promise<number> {
  const row = await prisma.agentChatSession.findUnique({
    where: { id: sessionId },
    select: { generation: true },
  });
  const generation = row?.generation ?? sessionGenerations.get(sessionId) ?? 0;
  sessionGenerations.set(sessionId, generation);
  return generation;
}
export async function isSessionGenerationCurrent(sessionId: string, generation: number): Promise<boolean> {
  const row = await prisma.agentChatSession.findUnique({
    where: { id: sessionId },
    select: { generation: true },
  });
  return (row?.generation ?? sessionGenerations.get(sessionId) ?? 0) === generation;
}
export async function clearSession(sessionId: string) {
  sessionGenerations.set(sessionId, (sessionGenerations.get(sessionId) ?? 0) + 1);
  await prisma.agentChatSession.update({
    where: { id: sessionId },
    data: { generation: { increment: 1 } },
  });
}
export async function persistTurnResult(input: { sessionId: string; generation: number }) {
  const row = await prisma.agentChatSession.findUnique({
    where: { id: input.sessionId },
    select: { generation: true },
  });
  const current = row?.generation ?? sessionGenerations.get(input.sessionId) ?? 0;
  return current !== input.generation ? { ignored: true } : { ignored: false };
}

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
 * 纯函数：根据关系计算合并后的完整消息列表（不触库，便于单测）。
 *
 * 策略（由 detectRelation 驱动）：
 * - new / truncate / disjoint：前端列表权威（truncate 截断尾部，new/disjoint 直写）。
 * - append：前端末条不在 DB → 找分歧点（前端最后一条存在于 DB 的消息），用 DB 补全前缀。
 *   分歧点缺失（理论不可达，detectRelation 已保证 append 有交集）时保守直写前端列表，不丢数据。
 */
export function computeMerged(
  relation: MergeRelation,
  uiMessages: UIMessage[],
  dbMessages: UIMessage[]
): UIMessage[] {
  if (relation !== "append") {
    return uiMessages;
  }
  const dbIds = new Set(dbMessages.map((m) => m.id));
  let divergence = -1;
  for (let i = uiMessages.length - 1; i >= 0; i--) {
    if (uiMessages[i].id && dbIds.has(uiMessages[i].id)) {
      divergence = i;
      break;
    }
  }
  if (divergence === -1) {
    return uiMessages;
  }
  const dbDivIdx = dbMessages.findIndex((m) => m.id === uiMessages[divergence].id);
  return [
    ...dbMessages.slice(0, dbDivIdx + 1),
    ...uiMessages.slice(divergence + 1),
  ];
}

/**
 * 合并前端消息与 DB 历史，避免分页/remount 导致的消息丢失。
 *
 * 问题背景：WritingAssistant 因页面级导航重挂载时只从 DB 分页加载最近若干条消息，
 * 下次发送/重跑时前端只传这些消息。若后端用 delete-all-recreate 语义盲目覆盖，
 * 被分页出去的旧消息会被永久删除。
 *
 * 并发安全：读（loadAllWithin）、合并（computeMerged）、写（saveWithin）收进同一交互式事务，
 * 串行化「读-改-写」，避免两个并发写者（如多个 onFinish、onFinish 与下轮 POST 的用户消息落盘）
 * 基于各自旧快照整表重写而后写覆盖先写（lost update）。
 *
 * 返回合并后的完整消息列表，供后续 originalMessages / Claude Agent prompt 使用。
 */
export async function mergeAndPersistMessages(
  sessionId: string,
  uiMessages: UIMessage[]
): Promise<UIMessage[]> {
  return prisma.$transaction(async (tx) => {
    const dbMessages = await loadAllWithin(tx, sessionId);
    const relation = detectRelation(uiMessages, dbMessages);
    const merged = computeMerged(relation, uiMessages, dbMessages);

    log.debug(
      {
        sessionId,
        relation,
        frontendCount: uiMessages.length,
        dbCount: dbMessages.length,
        mergedCount: merged.length,
      },
      "mergeAndPersistMessages 合并结果"
    );

    await saveWithin(tx, sessionId, merged);
    return merged;
  });
}

export async function mergeAndPersistMessagesIfGenerationCurrent(
  sessionId: string,
  generation: number,
  uiMessages: UIMessage[],
  opts: { activeTurnId?: string } = {}
): Promise<{
  ignored: boolean;
  conflict?: "initializing-client";
  messages?: UIMessage[];
}> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.agentChatSession.findUnique({
      where: { id: sessionId },
      select: { generation: true, activeTurnId: true },
    });
    if (session?.generation !== generation) return { ignored: true };
    if (
      opts.activeTurnId !== undefined &&
      session.activeTurnId !== opts.activeTurnId
    ) {
      return { ignored: true };
    }

    const dbMessages = await loadAllWithin(tx, sessionId);
    const merged = computeMergedMessages(dbMessages, uiMessages);
    if (merged.conflict) {
      log.warn(
        {
          sessionId,
          conflict: merged.conflict,
          frontendCount: uiMessages.length,
          dbCount: dbMessages.length,
        },
        "mergeAndPersistMessagesIfGenerationCurrent 检测到初始化冲突"
      );
      return {
        ignored: false,
        conflict: merged.conflict,
        messages: dbMessages,
      };
    }

    log.debug(
      {
        sessionId,
        frontendCount: uiMessages.length,
        dbCount: dbMessages.length,
        mergedCount: merged.messages.length,
      },
      "mergeAndPersistMessagesIfGenerationCurrent 合并结果"
    );

    await saveWithin(tx, sessionId, merged.messages);
    return { ignored: false, messages: merged.messages };
  });
}
