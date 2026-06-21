import fs from "node:fs";
import path from "node:path";
import { backupDir } from "@/lib/paths";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("migration.backup");

/** 备份滚动保留份数 */
const MAX_BACKUPS = 5;

/**
 * 迁移前备份数据库文件。
 *
 * 复制 inkpress.db → backups/inkpress.db.bak.<timestamp>。
 * 滚动清理超出 MAX_BACKUPS 的旧备份（按 mtime 升序删除最旧的）。
 *
 * @param dbFilePath 当前数据库文件路径
 * @returns 备份文件路径，或 null（源文件不存在时跳过）
 */
export function backupDatabase(dbFilePath: string): string | null {
  if (!fs.existsSync(dbFilePath)) {
    log.warn({ db: dbFilePath }, "数据库文件不存在，跳过备份");
    return null;
  }

  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });

  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
  const backupPath = path.join(dir, `inkpress.db.bak.${ts}`);

  // 同步复制（含 WAL/SHM 快照语义：better-sqlite3 默认非 WAL，单文件即可）
  fs.copyFileSync(dbFilePath, backupPath);
  log.info({ backup: backupPath }, "已创建迁移前数据库备份");

  rotateBackups(dir);
  return backupPath;
}

/** 滚动清理：仅保留最近 MAX_BACKUPS 份备份 */
function rotateBackups(dir: string): void {
  let entries: { name: string; mtime: number }[];
  try {
    entries = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("inkpress.db.bak."))
      .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime); // 旧 → 新
  } catch {
    return;
  }

  const excess = entries.slice(0, entries.length - MAX_BACKUPS);
  for (const e of excess) {
    try {
      fs.unlinkSync(path.join(dir, e.name));
      log.info({ removed: e.name }, "清理过期备份");
    } catch {
      /* 忽略单个删除失败 */
    }
  }
}
