import fs from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { dbPath, usesDataHome } from "@/lib/paths";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("db");

// Prisma 7：通过 driver adapter 连接 SQLite（零运维单文件）
function createPrismaClient() {
  const resolved = dbPath();
  // 打包形态：确保父目录存在（~/.inkpress 可能尚未创建）。同步创建，避免 lazy proxy 的复杂性。
  if (usesDataHome()) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const adapter = new PrismaBetterSqlite3({ url: resolved });

  // 查询事件钩子始终启用（用于慢查询监控）：
  // - 慢查询(>100ms)→warn 始终输出（异常情况，值得记录）
  // - 写操作→debug，生产(info)级别下 pino 置为 noop（零开销），LOG_LEVEL=debug 时输出
  //
  // 性能：Prisma query 事件对每条 SQL 同步分发回调，回调体仅做一次数值比较 + 一次
  // 字符串前缀判断（~0.5μs/查询）。30 查询/请求 ≈ 15μs/请求，相对 SQLite 查询本身
  // 的 50-500μs 可忽略。
  const client = new PrismaClient({ adapter, log: ["query"] });

  client.$on("query", (e) => {
    const durationMs = e.duration ?? 0;
    if (durationMs >= SLOW_THRESHOLD_MS) {
      log.warn({ durationMs, query: truncate(e.query) }, "慢查询");
      return;
    }
    // 写操作日志：debug 级别，生产(info)下为 noop，无序列化开销
    if (isWriteOperation(e.query)) {
      log.debug(
        { durationMs, op: extractOp(e.query), params: e.params },
        "写操作"
      );
    }
  });

  return client;
}

/** 慢查询阈值（ms） */
const SLOW_THRESHOLD_MS = 100;

/** SQL 写操作判定（前缀匹配，忽略大小写与空白） */
function isWriteOperation(sql: string): boolean {
  const head = sql.trimStart().slice(0, 12).toUpperCase();
  return (
    head.startsWith("INSERT ") ||
    head.startsWith("UPDATE ") ||
    head.startsWith("DELETE ") ||
    head.startsWith("CREATE ") ||
    head.startsWith("ALTER ") ||
    head.startsWith("DROP ") ||
    head.startsWith("PRAGMA ")
  );
}

/** 提取 SQL 操作类型（INSERT/UPDATE/...），用于日志字段 */
function extractOp(sql: string): string {
  const m = sql.trimStart().match(/^([A-Za-z]+)/);
  return m ? m[1].toUpperCase() : "UNKNOWN";
}

/** 截断 SQL 文本，避免超长日志 */
function truncate(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// 单例：避免开发模式热重载反复创建连接
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
