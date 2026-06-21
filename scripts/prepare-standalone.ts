/**
 * 打包前置：生成一个「去符号链接」的 standalone bundle 目录。
 *
 * Next.js standalone 输出的 node_modules 使用 pnpm 符号链接结构（.pnpm + 顶层 symlink），
 * electron-builder 的 extraResources 不会正确跟随符号链接，导致 node_modules 在打包后丢失。
 * 因此先把整个 standalone 复制到一个独立目录（dereference=true 解析所有符号链接为真实文件），
 * 再补齐 standalone 缺失的资源，最终 electron-builder 复制这个 bundle。
 *
 * 补齐内容：
 * - .next/static、public/（standalone 不含前端静态资源）
 * - src/generated/prisma（Prisma 生成客户端，非静态 import，未被追踪）
 * - resources/skills/system、themes、prisma/migrations（运行时 fs 读取的只读资源）
 * - better_sqlite3.node 原生绑定（确保顶层 + .pnpm 一致）
 *
 * 运行：pnpm tsx scripts/prepare-standalone.ts（在 pnpm build 之后）
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcStandalone = path.join(root, ".next", "standalone");
// 去符号链接的 bundle 目录（electron-builder 的 extraResources 指向此处）
const bundle = path.join(root, ".next", "standalone-bundle");

if (!fs.existsSync(srcStandalone)) {
  console.error("✗ .next/standalone 不存在，请先执行 pnpm build（需 output: standalone）");
  process.exit(1);
}

// 清理旧 bundle，重建
fs.rmSync(bundle, { recursive: true, force: true });

console.log("生成去符号链接的 standalone bundle…");
// 核心：dereference=true 把 pnpm 的 .pnpm 符号链接解析为真实文件
fs.cpSync(srcStandalone, bundle, { recursive: true, dereference: true });
console.log(`  ✓ standalone → ${path.relative(root, bundle)}（已解析符号链接）`);

// electron-builder 会从 extraResources 中剔除名为 node_modules 的目录（误判为 app 依赖）。
// 将其重命名为 app_modules，运行时由 Electron 主进程通过 NODE_PATH 指向它。
const nmDir = path.join(bundle, "node_modules");
const renamedDir = path.join(bundle, "app_modules");
if (fs.existsSync(renamedDir)) fs.rmSync(renamedDir, { recursive: true, force: true });
fs.renameSync(nmDir, renamedDir);
console.log(`  ✓ node_modules → app_modules（绕过 electron-builder 的 node_modules 剔除）`);

function copyInto(src: string, destRel: string, label: string) {
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠ 跳过 ${label}：源不存在 ${path.relative(root, src)}`);
    return;
  }
  const dest = path.join(bundle, destRel);
  fs.cpSync(src, dest, { recursive: true, dereference: true });
  console.log(`  ✓ ${label} → ${destRel}`);
}

// 1. 前端静态资源（standalone 不含）
copyInto(path.join(root, ".next", "static"), path.join(".next", "static"), ".next/static");
copyInto(path.join(root, "public"), "public", "public");

// 2. Prisma 生成的客户端
copyInto(
  path.join(root, "src", "generated", "prisma"),
  path.join("src", "generated", "prisma"),
  "src/generated/prisma"
);

// 3. 只读资源（系统 skill 只读原件 + 内置主题）
copyInto(
  path.join(root, "resources", "skills", "system"),
  path.join("resources", "skills", "system"),
  "resources/skills/system"
);
copyInto(path.join(root, "themes"), "themes", "themes");

// 4. Prisma migrations（首次启动建表用）
copyInto(path.join(root, "prisma", "migrations"), "migrations", "prisma/migrations");

// 5. better-sqlite3 原生绑定：确保 bundle 内顶层 + .pnpm 路径的 .node 文件存在且一致
ensureNativeBinding();

console.log("✓ standalone bundle 准备完成：" + path.relative(root, bundle));

function ensureNativeBinding() {
  // 从源 standalone 的 node_modules 取绑定（已是 node-127 prebuilt，适配 ELECTRON_RUN_AS_NODE）
  const src = findFile(
    path.join(srcStandalone, "node_modules", "better-sqlite3"),
    "better_sqlite3.node"
  );
  if (!src) {
    console.warn("  ⚠ 未在 standalone 找到 better_sqlite3.node");
    return;
  }
  // bundle 内 app_modules（已从 node_modules 重命名）所有 better_sqlite3.node 刷新为同一份
  const appModules = path.join(bundle, "app_modules");
  let refreshed = 0;
  const targets = findAllFiles(appModules, "better_sqlite3.node");
  for (const t of targets) {
    fs.copyFileSync(src, t);
    refreshed++;
  }
  console.log(`  ✓ better_sqlite3.node 已刷新 ${refreshed} 处`);
}

function findAllFiles(dir: string, name: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isFile() && e.name === name) results.push(full);
      else if (e.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return results;
}

function findFile(dir: string, name: string): string | null {
  const all = findAllFiles(dir, name);
  return all[0] ?? null;
}
