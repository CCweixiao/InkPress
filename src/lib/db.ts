import fs from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { dbPath, usesDataHome } from "@/lib/paths";

// Prisma 7：通过 driver adapter 连接 SQLite（零运维单文件）
function createPrismaClient() {
  const resolved = dbPath();
  // 打包形态：确保父目录存在（~/.inkpress 可能尚未创建）。同步创建，避免 lazy proxy 的复杂性。
  if (usesDataHome()) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const adapter = new PrismaBetterSqlite3({ url: resolved });
  return new PrismaClient({ adapter });
}

// 单例：避免开发模式热重载反复创建连接
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
