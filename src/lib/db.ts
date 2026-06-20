import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7：通过 driver adapter 连接 SQLite（零运维单文件）
function createPrismaClient() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  // 解析 file:./dev.db → 相对 cwd 的文件路径
  const dbPath = url.startsWith("file:") ? url.slice(5) : url;
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

// 单例：避免开发模式热重载反复创建连接
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
