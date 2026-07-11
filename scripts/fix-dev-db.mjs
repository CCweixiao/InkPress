/**
 * 一次性修复：把缺失的迁移应用到 dev.db，并同步 _prisma_migrations 记录。
 *
 * 背景：runMigrations 只在打包模式（usesDataHome）执行，dev 直接连 dev.db，
 * 而此前 schema 变更未走 prisma migrate dev，导致 dev.db 缺列/缺表。
 *
 * 仅修复 dev.db（相对路径），生产库由 runMigrations 在打包模式负责。
 * 幂等：所有变更都先判断存在性再执行。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = path.resolve(process.cwd(), "dev.db");
if (!fs.existsSync(dbPath)) {
  console.error(`✗ dev.db 不存在: ${dbPath}`);
  process.exit(1);
}
const db = new Database(dbPath);

const tableExists = (t) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t) !==
  undefined;

const applied = [];

// 1. CodeSourceGrant 表 + 索引（migration 20260621213000 的建表段）
db.transaction(() => {
  if (!tableExists("CodeSourceGrant")) {
    db.exec(`
      CREATE TABLE "CodeSourceGrant" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "sessionId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "sourceKey" TEXT NOT NULL,
        "displayName" TEXT NOT NULL,
        "locator" TEXT NOT NULL,
        "root" TEXT,
        "owner" TEXT,
        "repo" TEXT,
        "ref" TEXT,
        "cacheRoot" TEXT,
        "scope" TEXT NOT NULL DEFAULT 'session',
        "status" TEXT NOT NULL DEFAULT 'pending',
        "approvalTokenHash" TEXT,
        "approvedAt" DATETIME,
        "lastAccessedAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      );
    `);
    db.exec(
      `CREATE UNIQUE INDEX "CodeSourceGrant_sessionId_sourceKey_key" ON "CodeSourceGrant"("sessionId", "sourceKey");`
    );
    db.exec(
      `CREATE INDEX "CodeSourceGrant_sessionId_status_idx" ON "CodeSourceGrant"("sessionId", "status");`
    );
    db.exec(
      `CREATE INDEX "CodeSourceGrant_sourceKey_idx" ON "CodeSourceGrant"("sourceKey");`
    );
    applied.push("CodeSourceGrant (table + 3 indexes)");
  }
})();

// 3. 同步 _prisma_migrations：补 20260621213000 记录 + 把 unfinished 标记完成
db.transaction(() => {
  const now = new Date().toISOString();
  const hasCode = db
    .prepare("SELECT 1 FROM _prisma_migrations WHERE migration_name=?")
    .get("20260621213000_dynamic_code_sources");
  if (!hasCode) {
    // checksum 为 NOT NULL；与本项目自定义迁移（0702/0703/0704）一致用占位符
    db.prepare(
      `INSERT INTO _prisma_migrations (id, checksum, started_at, finished_at, migration_name, logs, rolled_back_at, applied_steps_count)
       VALUES (?,?,?,?,?,NULL,NULL,1)`
    ).run(
      randomUUID(),
      "00000000",
      now,
      now,
      "20260621213000_dynamic_code_sources"
    );
  }
  // 0702/0703/0704 之前 unfinished（DDL 实际已应用），补 finished_at
  const unfinished = db
    .prepare(
      "SELECT COUNT(*) n FROM _prisma_migrations WHERE finished_at IS NULL"
    )
    .get();
  if (unfinished.n > 0) {
    db.prepare(
      "UPDATE _prisma_migrations SET finished_at=? WHERE finished_at IS NULL"
    ).run(now);
    applied.push(`标记 ${unfinished.n} 条 unfinished 迁移为已完成`);
  }
})();

console.log("✓ Applied:", applied.length ? applied.join(", ") : "(无变更，dev.db 已是最新)");
console.log("\n验证:");
console.log("  CodeSourceGrant table?", tableExists("CodeSourceGrant"));
console.log("\n_prisma_migrations:");
db
  .prepare(
    "SELECT migration_name, CASE WHEN finished_at IS NULL THEN 'UNFINISHED' ELSE 'ok' END s FROM _prisma_migrations ORDER BY migration_name"
  )
  .all()
  .forEach((r) => console.log(`  - ${r.migration_name}  ${r.s}`));
db.close();
