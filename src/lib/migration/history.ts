import type Database from "better-sqlite3";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("migration.history");

/** 迁移历史表名 */
export const HISTORY_TABLE = "migration_history";

/** 迁移记录（写入历史表） */
export interface MigrationRecord {
  version: string; // 版本目录名（时间戳_name）
  description: string; // 目录名中下划线后的描述部分
  script: string; // 执行的脚本文件名
  checksum: number; // 32 位有符号校验和
  executionTimeMs: number;
}

/**
 * 建表 SQL：Flyway schema_history 风格。
 * version 唯一 → 幂等，重复插入会被 UNIQUE 约束拒绝（配合事务回滚）。
 */
const CREATE_HISTORY_SQL = `
CREATE TABLE IF NOT EXISTS "${HISTORY_TABLE}" (
  installed_rank    INTEGER PRIMARY KEY AUTOINCREMENT,
  version           TEXT NOT NULL UNIQUE,
  description       TEXT,
  type              TEXT NOT NULL DEFAULT 'SQL',
  script            TEXT,
  checksum          INTEGER NOT NULL,
  installed_by      TEXT NOT NULL DEFAULT 'inkpress',
  installed_on      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  execution_time_ms INTEGER,
  success           INTEGER NOT NULL DEFAULT 1
);
`;

/**
 * 确保迁移历史表存在。
 */
export function ensureHistoryTable(db: Database.Database): void {
  db.exec(CREATE_HISTORY_SQL);
}

/**
 * 读取已成功应用的版本集合。
 * 仅统计 success=1 的记录；失败记录（success=0）允许重试。
 */
export function getAppliedVersions(db: Database.Database): Set<string> {
  const rows = db
    .prepare(`SELECT version FROM ${HISTORY_TABLE} WHERE success = 1`)
    .all() as { version: string }[];
  return new Set(rows.map((r) => r.version));
}

/**
 * 在当前事务内记录一次成功迁移。
 * 必须在事务提交前调用 —— 与 DDL/DML 同事务，保证原子性。
 */
export function recordSuccess(db: Database.Database, rec: MigrationRecord): void {
  db.prepare(
    `INSERT INTO ${HISTORY_TABLE}
       (version, description, type, script, checksum, execution_time_ms, success)
     VALUES (?, ?, 'SQL', ?, ?, ?, 1)`
  ).run(rec.version, rec.description, rec.script, rec.checksum, rec.executionTimeMs);
}

/**
 * 记录一次失败迁移（success=0，便于审计）。
 * 注意：失败时主事务已回滚，DDL/DML 不会持久化；此处在外层独立事务写入失败标记。
 */
export function recordFailure(
  db: Database.Database,
  rec: Omit<MigrationRecord, "checksum" | "executionTimeMs"> & {
    checksum: number;
    executionTimeMs: number;
    error: string;
  }
): void {
  db.prepare(
    `INSERT OR REPLACE INTO ${HISTORY_TABLE}
       (version, description, type, script, checksum, execution_time_ms, success)
     VALUES (?, ?, 'SQL', ?, ?, ?, 0)`
  ).run(rec.version, rec.description, rec.script, rec.checksum, rec.executionTimeMs);
}

/**
 * 旧库兼容：若存在 Prisma 的 _prisma_migrations 表且 history 表为空，
 * 把已应用记录一次性导入 migration_history，避免对老用户重复执行迁移。
 *
 * 迁移完成后统一使用 migration_history，_prisma_migrations 不再维护（但保留以备审计）。
 */
export function importLegacyPrismaHistory(db: Database.Database): {
  imported: number;
  skipped: boolean;
} {
  ensureHistoryTable(db);

  const hasLegacy = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'`
    )
    .get();

  if (!hasLegacy) {
    return { imported: 0, skipped: true };
  }

  const historyCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM ${HISTORY_TABLE}`).get() as { c: number }
  ).c;
  if (historyCount > 0) {
    // 已有历史记录，无需导入
    return { imported: 0, skipped: true };
  }

  const legacyRows = db
    .prepare(
      `SELECT migration_name, checksum FROM _prisma_migrations WHERE rolled_back_at IS NULL`
    )
    .all() as { migration_name: string; checksum: string }[];

  if (legacyRows.length === 0) {
    return { imported: 0, skipped: true };
  }

  const insert = db.prepare(
    `INSERT INTO ${HISTORY_TABLE}
       (version, description, type, script, checksum, success)
     VALUES (?, ?, 'SQL', ?, ?, 1)`
  );

  const tx = db.transaction((rows: typeof legacyRows) => {
    for (const row of rows) {
      const desc = describeVersion(row.migration_name);
      // checksum 文本无法可靠转回整数，这里存 0 表示「历史导入，未校验」
      insert.run(row.migration_name, desc, "migration.sql", 0);
    }
  });
  tx(legacyRows);

  log.info(
    { count: legacyRows.length },
    "已从 _prisma_migrations 导入历史迁移记录"
  );
  return { imported: legacyRows.length, skipped: false };
}

/** 从版本目录名提取描述（时间戳_name → name，下划线转空格） */
export function describeVersion(versionDir: string): string {
  const idx = versionDir.indexOf("_");
  if (idx < 0) return versionDir;
  return versionDir
    .slice(idx + 1)
    .replace(/_/g, " ")
    .trim();
}
