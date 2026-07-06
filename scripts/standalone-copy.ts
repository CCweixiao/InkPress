import fs from "node:fs";
import path from "node:path";

export function copyStandaloneTree(
  src: string,
  dest: string,
  platform: NodeJS.Platform = process.platform
): number {
  const needsWindowsFallback = platform === "win32";
  fs.cpSync(src, dest, { recursive: true, dereference: !needsWindowsFallback });
  if (!needsWindowsFallback) return 0;
  return materializeSymlinks(dest);
}

function materializeSymlinks(rootDir: string): number {
  let replaced = 0;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const stat = fs.lstatSync(full);

      if (stat.isSymbolicLink()) {
        let target: string;
        let targetStat: fs.Stats;
        try {
          target = fs.realpathSync(full);
          targetStat = fs.statSync(target);
        } catch {
          // 悬空链接在打包产物中不可用，直接清理，避免中断整个拷贝流程
          fs.rmSync(full, { recursive: true, force: true });
          replaced += 1;
          continue;
        }
        fs.rmSync(full, { recursive: true, force: true });
        if (targetStat.isDirectory()) {
          fs.cpSync(target, full, { recursive: true, dereference: true });
          walk(full);
        } else {
          fs.copyFileSync(target, full);
        }
        replaced += 1;
        continue;
      }

      if (stat.isDirectory()) walk(full);
    }
  };

  walk(rootDir);
  return replaced;
}
