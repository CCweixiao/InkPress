import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { prisma } from "@/lib/db";

/**
 * Prisma/SQLite SessionStore（P5）：把 Claude Agent SDK 的 transcript 条目镜像到
 * ClaudeAgentSessionEntry 表，供**跨轮 / 跨进程 resume**（SDK 的 load 物化临时 JSONL → 子进程 resume）。
 *
 - append：有 uuid 的条目按 (projectKey,sdkSessionId,subpath,uuid) **幂等 upsert**（SDK 重试 /
 *   importSessionToStore 重放不产生重复行）；无 uuid（标题/标签等）直接追加。单事务批量写。
 - load：按 createdAt 升序读全部条目 → 解析回 SessionStoreEntry[]；空则 null。
 - listSubkeys：列子 agent 的 subpath（resume 物化需要）。
 *
 * SDK 的 SessionStore 接口里 listSessions/listSessionSummaries/delete 为可选，此处不实现。
 */
export function createPrismaSessionStore(): SessionStore {
  return {
    async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
      if (entries.length === 0) return;
      const projectKey = key.projectKey;
      const sdkSessionId = key.sessionId;
      const subpath = key.subpath ?? "";
      await prisma.$transaction(
        entries.map((entry) => {
          const entryJson = JSON.stringify(entry);
          const uuid =
            typeof entry.uuid === "string" && entry.uuid ? entry.uuid : null;
          if (uuid) {
            // 幂等 upsert：uuid 重复（重试 / 重放）不产生新行，仅更新内容。
            return prisma.claudeAgentSessionEntry.upsert({
              where: {
                projectKey_sdkSessionId_subpath_uuid: {
                  projectKey,
                  sdkSessionId,
                  subpath,
                  uuid,
                },
              },
              create: { projectKey, sdkSessionId, subpath, uuid, entryJson },
              update: { entryJson },
            });
          }
          return prisma.claudeAgentSessionEntry.create({
            data: { projectKey, sdkSessionId, subpath, uuid: null, entryJson },
          });
        })
      );
    },

    async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
      const rows = await prisma.claudeAgentSessionEntry.findMany({
        where: {
          projectKey: key.projectKey,
          sdkSessionId: key.sessionId,
          subpath: key.subpath ?? "",
        },
        orderBy: { createdAt: "asc" },
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
