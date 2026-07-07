import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { inkpressHomeDir } from "@/lib/paths";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("data-portability");

/** 恢复出厂标记文件（API 写入 → Electron 主进程下次启动时清空数据目录后删除）。 */
const RESET_MARKER = ".reset";
/** 导出包排除的顶层项：cache（可重建）、logs（运行态）。.secret 保留——导出包需可解密 key。 */
const EXPORT_EXCLUDE_TOP = new Set(["cache", "logs"]);
/** 导出包额外排除的根级文件（待执行的重置标记；临时导出文件）。 */
const EXPORT_EXCLUDE_ROOT_FILES = new Set([RESET_MARKER, ".export-tmp"]);

/** 判定相对路径是否应排除出导出包。 */
function shouldExcludeFromExport(relPath: string): boolean {
  const segs = relPath.split(/[\\/]/);
  if (EXPORT_EXCLUDE_TOP.has(segs[0])) return true;
  if (segs.length === 1 && EXPORT_EXCLUDE_ROOT_FILES.has(segs[0])) return true;
  return false;
}

/**
 * 构建数据导出包（zip Buffer）：完整 inkpressHome，排除 cache/logs/重置标记。
 * 含 .secret——包内 DB 的加密 key 随包迁移（用户主动导出，属可接受权衡）。
 * 不含 Date/random，纯同步遍历。
 */
export function buildDataExportZip(): Buffer {
  const home = inkpressHomeDir();
  const zip = new AdmZip();
  addDirToZip(zip, home, "");
  return zip.toBuffer();
}

function addDirToZip(zip: AdmZip, absDir: string, relPrefix: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
    if (shouldExcludeFromExport(rel)) continue;
    const abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      addDirToZip(zip, abs, rel);
    } else if (ent.isFile()) {
      // addLocalFile(localPath, zipPath=目录)
      try {
        zip.addLocalFile(abs, relPrefix);
      } catch (e) {
        log.warn({ err: e, file: rel }, "跳过无法读取的文件");
      }
    }
  }
}

/** 写入恢复出厂标记（server 侧；主进程下次启动时兑现）。 */
export function writeResetMarker(): void {
  const marker = path.join(inkpressHomeDir(), RESET_MARKER);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(
    marker,
    JSON.stringify({ requestedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  log.info({ marker }, "已写入恢复出厂标记，等待主进程下次启动兑现");
}
