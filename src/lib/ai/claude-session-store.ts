import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";

/**
 * Prisma/SQLite SessionStore（P5）：把 Claude Agent SDK 的 transcript 条目镜像到
 * ClaudeAgentSessionEntry 表，供**跨轮 / 跨进程 resume**（SDK 的 load 物化临时 JSONL → 子进程 resume）。
 *
 - append：同批 entries 按 append-call 顺序分配**单调 appendSeq**（事务内读当前 max 后递增）；
 *   有 uuid 的条目按 (projectKey,sdkSessionId,subpath,uuid) **幂等 upsert**（SDK 重试 / 重放不产生
 *   重复行；update 分支不触碰 appendSeq → 重放不破坏顺序）；无 uuid（标题/标签等）直接追加。
 *   entryType / entryTimestamp 从 entry 冗余，便于排障与按类型清理（session PDC §6.2/§7.4）。
 - load：按 appendSeq(nulls first) + createdAt 升序读全部条目 → 解析回 SessionStoreEntry[]；空则 null。
 - listSubkeys：列子 agent 的 subpath（resume 物化需要）。
 *
 * SDK 的 SessionStore 接口里 listSessions/listSessionSummaries/delete 为可选，此处不实现。
 */

/** 解析 entry.timestamp（ISO 字符串）为 Date；非法/缺失返回 null。 */
function parseEntryTimestamp(ts: unknown): Date | null {
  if (typeof ts !== "string" || !ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function createPrismaSessionStore(
  prisma: PrismaClient = defaultPrisma
): SessionStore {
  return {
    async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
      if (entries.length === 0) return;
      const projectKey = key.projectKey;
      const sdkSessionId = key.sessionId;
      const subpath = key.subpath ?? "";

      // 单事务：读当前 max(appendSeq) → 同批按数组顺序递增分配。
      // 同一 session/subpath 的 append 在单进程内由 SDK 串行 await，事务保证读-写原子、appendSeq 单调。
      await prisma.$transaction(async (tx) => {
        const whereKey = { projectKey, sdkSessionId, subpath };
        // 预查本批中已存在的 uuid：重放条目不消耗 appendSeq，保证已落库行的序连续无空洞。
        const uuidsInBatch = entries
          .map((e) => e.uuid)
          .filter((u): u is string => typeof u === "string" && !!u);
        const existingUuids =
          uuidsInBatch.length > 0
            ? new Set(
                (
                  await tx.claudeAgentSessionEntry.findMany({
                    where: { ...whereKey, uuid: { in: uuidsInBatch } },
                    select: { uuid: true },
                  })
                )
                  .map((r) => r.uuid)
                  .filter((u): u is string => !!u)
              )
            : new Set<string>();
        const maxRow = await tx.claudeAgentSessionEntry.aggregate({
          _max: { appendSeq: true },
          where: whereKey,
        });
        let seq = maxRow._max.appendSeq ?? 0;
        for (const entry of entries) {
          const entryJson = JSON.stringify(entry);
          const uuid =
            typeof entry.uuid === "string" && entry.uuid ? entry.uuid : null;
          const entryType =
            typeof entry.type === "string" && entry.type ? entry.type : null;
          const entryTimestamp = parseEntryTimestamp(entry.timestamp);
          // 仅「将新增的行」消耗一个 appendSeq：无 uuid 恒为新；有 uuid 且未存在才算新。
          const isNew = !uuid || !existingUuids.has(uuid);
          if (isNew) seq += 1;
          const appendSeq = isNew ? seq : null;
          if (uuid) {
            // 幂等 upsert：uuid 重复（重试 / 重放）命中 update 分支，不触碰 appendSeq/顺序。
            // 仅 create 分支分配 appendSeq，保证新条目落在既有最大值之后。
            await tx.claudeAgentSessionEntry.upsert({
              where: {
                projectKey_sdkSessionId_subpath_uuid: {
                  projectKey,
                  sdkSessionId,
                  subpath,
                  uuid,
                },
              },
              create: {
                projectKey,
                sdkSessionId,
                subpath,
                uuid,
                entryJson,
                appendSeq,
                entryType,
                entryTimestamp,
              },
              update: { entryJson, entryType, entryTimestamp },
            });
            existingUuids.add(uuid);
          } else {
            // 无 uuid（标题/标签/mode 等）：不去重，直接追加（SQLite unique 对 NULL 不去重）。
            await tx.claudeAgentSessionEntry.create({
              data: {
                projectKey,
                sdkSessionId,
                subpath,
                uuid: null,
                entryJson,
                appendSeq,
                entryType,
                entryTimestamp,
              },
            });
          }
        }
      });
    },

    async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
      const rows = await prisma.claudeAgentSessionEntry.findMany({
        where: {
          projectKey: key.projectKey,
          sdkSessionId: key.sessionId,
          subpath: key.subpath ?? "",
        },
        // appendSeq 保序：迁移前旧行 appendSeq 为 NULL（nulls first），createdAt 兜底。
        orderBy: [
          { appendSeq: { sort: "asc", nulls: "first" } },
          { createdAt: "asc" },
        ],
        select: { entryJson: true },
      });
      if (rows.length === 0) return null;
      return rows.map((row) => JSON.parse(row.entryJson) as SessionStoreEntry);
    },

    async listSubkeys(key: {
      projectKey: string;
      sessionId: string;
    }): Promise<string[]> {
      const rows = await prisma.claudeAgentSessionEntry.findMany({
        where: {
          projectKey: key.projectKey,
          sdkSessionId: key.sessionId,
          NOT: { subpath: "" },
        },
        distinct: ["subpath"],
        select: { subpath: true },
      });
      return rows
        .map((r) => r.subpath)
        .filter((s): s is string => typeof s === "string" && s.length > 0);
    },
  };
}
