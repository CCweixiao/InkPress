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
import { spawnSync } from "node:child_process";

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

// 5. better-sqlite3 原生绑定：为 Electron ABI 重新编译（ELECTRON_RUN_AS_NODE 下
//    Electron 42 的 Node ABI=146，与标准 Node 22 的 prebuilt ABI=127 不匹配）
ensureNativeBindingForElectron();

// 6. 瘦身：剔除运行时不需要的文件（编译期产物、源码、类型声明、文档）
slimBundle();

console.log("✓ standalone bundle 准备完成：" + path.relative(root, bundle));

/**
 * 为 Electron ABI 重新编译 bundle 内的 better-sqlite3。
 *
 * ELECTRON_RUN_AS_NODE=1 下，Electron 42 内嵌 Node 的 ABI=146，
 * 而 better-sqlite3 官方 prebuilt 针对标准 Node（ABI=127），两者不匹配。
 * 用 @electron/rebuild 针对当前 electron 版本重新编译原生绑定。
 *
 * 注意：必须在 bundle 的 app_modules 上跑（而非项目 node_modules），
 * 因为 standalone 用 NODE_PATH 指向 app_modules 解析依赖。
 */
function ensureNativeBindingForElectron() {
  console.log("  → 为 Electron 重编译 better-sqlite3 原生绑定…");

  // 在项目根目录用 electron-rebuild 重编译（需要标准 node_modules 结构）
  const electronVersion = JSON.parse(
    fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8")
  ).version;

  const result = spawnSync(
    "npx",
    ["--yes", "electron-rebuild", "-f", "-w", "better-sqlite3", "--version", electronVersion],
    {
      cwd: root,
      env: {
        ...process.env,
        npm_config_runtime: "electron",
        npm_config_target: electronVersion,
        npm_config_disturl: "https://electronjs.org/headers",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    console.warn(`  ⚠ electron-rebuild 失败（退出码 ${result.status}），better-sqlite3 可能无法加载`);
    return;
  }

  // 把重编译后的 .node 复制到 bundle 的所有 better-sqlite3 副本
  const src = findFile(
    path.join(root, "node_modules", ".pnpm"),
    "better_sqlite3.node"
  );
  if (!src) {
    console.warn("  ⚠ 项目 node_modules 找不到重编译后的 better_sqlite3.node");
    return;
  }
  const appModules = path.join(bundle, "app_modules");
  let refreshed = 0;
  const targets = findAllFiles(appModules, "better_sqlite3.node");
  for (const t of targets) {
    fs.copyFileSync(src, t);
    refreshed++;
  }
  console.log(`  ✓ better-sqlite3（Electron ABI）已刷新 ${refreshed} 处`);
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

/**
 * 从 bundle 内删除运行时（生产环境）不需要的文件，减小打包体积。
 *
 * 安全策略：只删确认无用的，保留所有 .js / .node / .json / .css / .wasm。
 * 删除清单：
 * - better-sqlite3/{deps,src}/：sqlite 源码与 C++ 源码（运行时只用 build/Release/*.node）
 * - *.d.ts / *.ts / *.map：TypeScript 声明与源码映射（生产环境不编译）
 * - *.md / LICENSE* / CHANGELOG* / README*：文档与许可证（不影响运行）
 * - .bin/：npm bin 脚本（shell 包装，运行时不走 npm）
 */
function slimBundle() {
  let removedFiles = 0;
  let removedBytes = 0;

  const shouldRemove = (filePath: string): boolean => {
    const base = path.basename(filePath);
    const rel = path.relative(bundle, filePath);

    // 1. better-sqlite3 的编译期产物（sqlite 源码 + C++ 源码）
    if (rel.includes("better-sqlite3")) {
      if (rel.includes("/deps/") || rel.includes("/src/")) return true;
    }

    // 2. 按扩展名/文件名剔除
    if (base.endsWith(".d.ts")) return true;
    if (base.endsWith(".d.mts")) return true;
    if (base.endsWith(".d.cts")) return true;
    if (base.endsWith(".ts") && !base.endsWith(".d.ts")) return true;
    if (base.endsWith(".ts.map")) return true;
    if (base.endsWith(".js.map")) return true;
    if (base.endsWith(".md") || base.endsWith(".markdown")) return true;
    if (base.endsWith(".tgz")) return true;
    if (base === "LICENSE" || base.startsWith("LICENSE.") || base.startsWith("LICENCE")) return true;
    if (base.startsWith("CHANGELOG") || base.startsWith("changelog")) return true;
    if (base === "README" || base.startsWith("README.")) return true;

    // 3. npm .bin 目录（shell 包装脚本）
    if (rel.includes("/.bin/") || rel === "app_modules/.bin") return true;

    // 4. 隐藏文件 / 编辑器配置 / CI 配置
    if (base === ".DS_Store" || base === ".npmignore" || base === ".editorconfig") return true;
    if (base === ".travis.yml" || base === "appveyor.yml" || base === "circle.yml") return true;

    return false;
  };

  // 遍历 bundle，删除匹配的文件
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        // 删完子文件后，若目录变空则删除空目录
        try {
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        } catch {
          /* 非空或不存在，忽略 */
        }
      } else if (entry.isFile() && shouldRemove(full)) {
        try {
          const size = fs.statSync(full).size;
          fs.rmSync(full);
          removedFiles++;
          removedBytes += size;
        } catch {
          /* 删除失败，忽略 */
        }
      }
    }
  };

  walk(bundle);
  console.log(`  ✓ 瘦身完成：删除 ${removedFiles} 个文件（约 ${(removedBytes / 1024 / 1024).toFixed(1)} MB）`);
}
