/**
 * SQLite 在线备份脚本（Phase 4，PDC §11）。
 *
 * 用 better-sqlite3 的 db.backup() —— SQLite Online Backup API，服务运行中安全，
 * 不锁库、不停服。产物写到 ./backups/，按 BACKUP_RETENTION 保留最近 N 份。
 *
 * 用法：pnpm db:backup
 * cron 示例：0 3 * * * cd /app/inkpress-service && pnpm db:backup
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const RETENTION = Number(process.env.BACKUP_RETENTION) || 14;

/** 解析 DATABASE_URL → 绝对库文件路径（与 src/lib/db.ts 同款逻辑，脚本独立直连不走 Prisma）。 */
function resolveDbPath(): string {
  const raw = (process.env.DATABASE_URL ?? "file:./dev.db").trim();
  const stripped = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  return path.isAbsolute(stripped) ? stripped : path.resolve(process.cwd(), stripped);
}

async function main() {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`✗ 数据库不存在：${dbPath}（先 pnpm db:migrate）`);
    process.exit(1);
  }

  const backupDir = path.resolve(process.cwd(), "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.resolve(backupDir, `inkpress-service-${ts}.db`);

  // readonly 打开源库，避免误写；db.backup() 走 SQLite Online Backup API，
  // 返回 Promise，必须 await 后再 close，否则备份被中断、文件不完整。
  const db = new Database(dbPath, { readonly: true });
  const t0 = Date.now();
  await db.backup(dest);
  db.close();
  const sizeKb = Math.round(fs.statSync(dest).size / 1024);

  // 留存清理：按 mtime 降序保留最近 RETENTION 份
  const all = fs
    .readdirSync(backupDir)
    .filter((f) => /^inkpress-service-.*\.db$/.test(f))
    .map((f) => ({ f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  let removed = 0;
  for (const item of all.slice(RETENTION)) {
    fs.unlinkSync(path.join(backupDir, item.f));
    removed++;
  }

  console.log(
    `✓ 备份完成：${path.relative(process.cwd(), dest)}（${sizeKb} KB，${Date.now() - t0}ms）`
  );
  console.log(`  现存备份 ${all.length - removed} 份，本次清理 ${removed} 份（保留 ${RETENTION}）`);
}

main().catch((err) => {
  console.error("✗ 备份失败：", err instanceof Error ? err.message : err);
  process.exit(1);
});
