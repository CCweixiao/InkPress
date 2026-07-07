import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { backupDir } from "@/lib/paths";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("migration.backup");

/** 备份滚动保留份数 */
const MAX_BACKUPS = 5;
/** 备份总字节上限（超出则按最旧优先删除，避免大库备份挤爆磁盘） */
const MAX_TOTAL_BACKUP_BYTES = 500 * 1024 * 1024; // 500MB

/** 备份文件名前缀（rotate 与 sidecar 清理据此识别） */
const BAK_PREFIX = "inkpress.db.bak.";
/** sha256 sidecar 后缀（与备份同目录，可用 `sha256sum -c` 校验） */
const SHA_SUFFIX = ".sha256sum";

/**
 * 迁移前备份数据库文件。
 *
 * 复制 inkpress.db → backups/inkpress.db.bak.<timestamp>，并写同名 .sha256sum 校验 sidecar。
 * 滚动清理：按份数（MAX_BACKUPS）+ 按总字节（MAX_TOTAL_BACKUP_BYTES）双维度，最旧优先删除，
 * 并同步清理对应的 .sha256sum sidecar，避免孤儿文件。
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
  const backupPath = path.join(dir, `${BAK_PREFIX}${ts}`);

  // 同步复制（含 WAL/SHM 快照语义：better-sqlite3 默认非 WAL，单文件即可）
  fs.copyFileSync(dbFilePath, backupPath);

  // 写 sha256 sidecar，便于校验备份完整性（防静默损坏 / 传输校验）
  try {
    const sha = sha256OfFile(backupPath);
    fs.writeFileSync(
      `${backupPath}${SHA_SUFFIX}`,
      `${sha}  ${path.basename(backupPath)}\n`,
      "utf8"
    );
  } catch (e) {
    log.warn({ err: e, backup: backupPath }, "写备份 sha256 sidecar 失败（不影响迁移）");
  }

  log.info({ backup: backupPath }, "已创建迁移前数据库备份");

  rotateBackups(dir);
  return backupPath;
}

/** 计算文件 sha256（DB 通常 ≤ 数十 MB，整体读取可接受） */
function sha256OfFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** 列出备份条目（含 mtime / size），旧 → 新排序 */
function listBackups(dir: string): { name: string; mtime: number; size: number }[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(BAK_PREFIX) && !n.endsWith(SHA_SUFFIX))
      .map((name) => {
        const st = fs.statSync(path.join(dir, name));
        return { name, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => a.mtime - b.mtime); // 旧 → 新
  } catch {
    return [];
  }
}

/** 删除一个备份及其 sha256 sidecar */
function removeBackup(dir: string, name: string): void {
  try {
    fs.unlinkSync(path.join(dir, name));
  } catch {
    /* 忽略 */
  }
  const sidecar = `${name}${SHA_SUFFIX}`;
  try {
    fs.unlinkSync(path.join(dir, sidecar));
  } catch {
    /* sidecar 可能不存在 */
  }
  log.info({ removed: name }, "清理过期备份");
}

/**
 * 滚动清理：双维度取齐。
 * 1) 份数：仅保留最近 MAX_BACKUPS 份；
 * 2) 总字节：累计超 MAX_TOTAL_BACKUP_BYTES 时，从最旧起继续删。
 */
function rotateBackups(dir: string): void {
  const entries = listBackups(dir);

  // 1) 份数维度
  const byCount = entries.slice(0, Math.max(0, entries.length - MAX_BACKUPS));
  for (const e of byCount) removeBackup(dir, e.name);

  // 2) 总字节维度（在份数清理后重新统计）
  const remaining = listBackups(dir);
  let total = remaining.reduce((s, e) => s + e.size, 0);
  for (const e of remaining) {
    if (total <= MAX_TOTAL_BACKUP_BYTES) break;
    total -= e.size;
    removeBackup(dir, e.name);
  }
}
