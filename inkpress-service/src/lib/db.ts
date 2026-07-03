import fs from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("db");

/**
 * 解析 SQLite 文件路径（来自 DATABASE_URL，形如 `file:/data/inkpress-service.db`
 * 或开发态 `file:./dev.db`）：去掉 `file:` 前缀，相对路径按 cwd 解析为绝对路径，
 * 并确保父目录存在（容器 /data 或本地首启）。
 */
function resolveDbPath(): string {
  const raw = (process.env.DATABASE_URL ?? "file:./dev.db").trim();
  const stripped = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  const abs = path.isAbsolute(stripped)
    ? stripped
    : path.resolve(process.cwd(), stripped);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

/**
 * Prisma 7 单例 client（driver adapter）。
 *
 * Prisma 7 取消了内置直连引擎，必须通过 driver adapter 连接 SQLite。
 * 使用 @prisma/adapter-better-sqlite3（与 InkPress 主应用一致）。单例化避免开发态热重载反复建连。
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const dbPath = resolveDbPath();
  log.info({ dbPath }, "数据库路径");
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
