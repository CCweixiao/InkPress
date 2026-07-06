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
        const target = fs.realpathSync(full);
        fs.rmSync(full, { recursive: true, force: true });
        const targetStat = fs.statSync(target);
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
