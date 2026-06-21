import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { backupDatabase } from "@/lib/migration/backup";
import {
  ensureHistoryTable,
  getAppliedVersions,
  recordSuccess,
  recordFailure,
  importLegacyPrismaHistory,
  describeVersion,
} from "@/lib/migration/history";
import { migrationScriptsDir } from "@/lib/paths";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("migration.runner");

/** 迁移版本目录信息 */
interface VersionEntry {
  dir: string; // 版本目录名（时间戳_name）
  path: string; // 绝对路径
  hasMigration: boolean; // 是否存在 migration.sql
  hasData: boolean; // 是否存在 data.sql
}

/**
 * 版本化迁移执行器（Flyway 式）。
 *
 * 设计要点：
 * 1. **跨版本安全**：按版本目录名（时间戳）升序逐个补齐未执行版本。
 *    每个版本脚本假定其前所有版本已应用 → 天然支持跳版本更新。
 * 2. **事务原子**：每个版本的 DDL(migration.sql) + DML(data.sql) + 历史记录
 *    在同一事务内提交；失败则整体回滚。
 * 3. **双重追踪**：DB 表 migration_history 为真相源（事务安全），
 *    ~/.inkpress/database/scripts/<version>/.success 为审计标识（文件）。
 * 4. **幂等**：data.sql 用 INSERT OR IGNORE；崩溃后重跑安全。
 *
 * @param dbFilePath 数据库文件路径
 * @param migrationsRoot 迁移脚本源目录（打包后 Resources/migrations）
 */
export async function runMigrations(
  dbFilePath: string,
  migrationsRoot: string
): Promise<void> {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbFilePath);
  try {
    // 1. 建历史表 + 兼容导入旧 _prisma_migrations（老用户首升级）
    ensureHistoryTable(db);
    importLegacyPrismaHistory(db);

    // 2. 收集已应用版本
    const applied = getAppliedVersions(db);

    // 3. 扫描待执行版本（升序）
    const versions = scanVersions(migrationsRoot);
    const pending = versions.filter((v) => !applied.has(v.dir));

    if (pending.length === 0) {
      log.info({ db: dbFilePath }, "无待执行迁移，数据库已是最新");
      return;
    }

    // 4. 迁移前备份
    const backupPath = backupDatabase(dbFilePath);
    log.info(
      { pending: pending.length, backup: backupPath },
      "发现待执行迁移，已备份数据库"
    );

    // 5. 逐版本执行
    for (const version of pending) {
      applyVersion(db, version);
    }

    log.info(
      { applied: pending.length, db: dbFilePath },
      "全部迁移已成功应用"
    );
  } finally {
    db.close();
  }
}

/**
 * 扫描迁移目录，返回按目录名升序排列的版本条目。
 * 仅保留含 migration.sql 或 data.sql 的目录。
 */
function scanVersions(migrationsRoot: string): VersionEntry[] {
  if (!fs.existsSync(migrationsRoot)) {
    log.warn({ dir: migrationsRoot }, "迁移目录不存在");
    return [];
  }
  const entries: VersionEntry[] = [];
  for (const name of fs.readdirSync(migrationsRoot)) {
    const full = path.join(migrationsRoot, name);
    if (!fs.statSync(full).isDirectory()) continue;
    const migrationSql = path.join(full, "migration.sql");
    const dataSql = path.join(full, "data.sql");
    const hasMigration = fs.existsSync(migrationSql);
    const hasData = fs.existsSync(dataSql);
    if (!hasMigration && !hasData) continue; // 空目录跳过
    entries.push({ dir: name, path: full, hasMigration, hasData });
  }
  // 目录名按字典序升序（时间戳前缀保证顺序）
  entries.sort((a, b) => a.dir.localeCompare(b.dir));
  return entries;
}

/**
 * 执行单个版本：事务内跑 DDL + DML，写历史记录；
 * 成功后写 .success 审计标识。
 * 失败则事务回滚，独立事务记录失败标记，并抛错。
 */
function applyVersion(db: Database.Database, version: VersionEntry): void {
  const migrationSql = version.hasMigration
    ? fs.readFileSync(path.join(version.path, "migration.sql"), "utf8")
    : "";
  const dataSql = version.hasData
    ? fs.readFileSync(path.join(version.path, "data.sql"), "utf8")
    : "";

  const checksum = computeChecksum(migrationSql + "\n" + dataSql);
  const description = describeVersion(version.dir);
  const start = Date.now();

  log.info({ version: version.dir }, "开始应用迁移");

  try {
    // 事务包裹 DDL + DML + 历史记录，任一失败整体回滚
    const tx = db.transaction(() => {
      if (migrationSql.trim()) db.exec(migrationSql);
      if (dataSql.trim()) db.exec(dataSql);
      recordSuccess(db, {
        version: version.dir,
        description,
        script: version.hasMigration ? "migration.sql" : "data.sql",
        checksum,
        executionTimeMs: Date.now() - start,
      });
    });
    tx();
  } catch (e) {
    const elapsed = Date.now() - start;
    log.error({ version: version.dir, err: e, elapsed }, "迁移失败，已回滚事务");
    // 独立事务记录失败（主事务已回滚，历史记录未写入）
    try {
      recordFailure(db, {
        version: version.dir,
        description,
        script: version.hasMigration ? "migration.sql" : "data.sql",
        checksum,
        executionTimeMs: elapsed,
        error: e instanceof Error ? e.message : String(e),
      });
    } catch {
      /* 记录失败不应阻断错误传播 */
    }
    throw e;
  }

  // 事务提交成功后，写 .success 审计标识 + 拷贝脚本留档
  writeSuccessMarker(version, checksum, Date.now() - start);
  log.info({ version: version.dir, elapsed: Date.now() - start }, "迁移已应用");
}

/**
 * 写 .success 审计标识，并把脚本副本拷贝到 ~/.inkpress/database/scripts/<version>/。
 *
 * .success 内容为 JSON：{ version, appliedAt, durationMs, checksum, files }
 * 幂等：重复写入会覆盖。
 */
function writeSuccessMarker(
  version: VersionEntry,
  checksum: number,
  durationMs: number
): void {
  try {
    const scriptsRoot = migrationScriptsDir();
    const destDir = path.join(scriptsRoot, version.dir);
    fs.mkdirSync(destDir, { recursive: true });

    // 拷贝脚本副本（留档）
    if (version.hasMigration) {
      fs.copyFileSync(
        path.join(version.path, "migration.sql"),
        path.join(destDir, "migration.sql")
      );
    }
    if (version.hasData) {
      fs.copyFileSync(
        path.join(version.path, "data.sql"),
        path.join(destDir, "data.sql")
      );
    }

    // 写 .success 标识
    const marker = {
      version: version.dir,
      appliedAt: new Date().toISOString(),
      durationMs,
      checksum,
      files: [
        version.hasMigration && "migration.sql",
        version.hasData && "data.sql",
      ].filter(Boolean) as string[],
    };
    fs.writeFileSync(
      path.join(destDir, ".success"),
      JSON.stringify(marker, null, 2),
      "utf8"
    );
  } catch (e) {
    // 审计标识写入失败不影响迁移结果（DB 已是真相源）
    log.warn({ version: version.dir, err: e }, "写 .success 审计标识失败（不影响迁移）");
  }
}

/**
 * 计算校验和（32 位有符号整数，Flyway 兼容风格）。
 * 仅用于审计与防篡改提示，不阻断执行。
 */
function computeChecksum(text: string): number {
  // CRC32 实现
  let crc = 0xffffffff;
  const table = getCrcTable();
  for (let i = 0; i < text.length; i++) {
    crc = table[(crc ^ text.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) | 0; // 转为有符号 32 位
}

let crcTableCache: number[] | null = null;
function getCrcTable(): number[] {
  if (crcTableCache) return crcTableCache;
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  crcTableCache = table;
  return table;
}
