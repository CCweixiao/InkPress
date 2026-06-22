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
// 第一步：复制（dereference=true 会跟随 symlink 读文件内容，但对 symlink 目录本身
// 仍会重建为 symlink —— pnpm 的 .pnpm 结构正是如此，导致 bundle 内残留指向项目源码
// 目录的绝对路径符号链接，打包到其他机器后全部失效）。
fs.cpSync(srcStandalone, bundle, { recursive: true, dereference: true });
// 第二步：把残留的符号链接全部物化为真实文件（关键修复）
const materialized = materializeSymlinks(bundle);
console.log(
  `  ✓ standalone → ${path.relative(root, bundle)}（已解析符号链接，物化 ${materialized} 处 symlink → 真实文件）`
);

// 注：node_modules 保留原名（不改名 app_modules）。
// extraResources 不受 build.files 规则的 "!**/node_modules/**" 约束（那仅作用于 app.asar 内部），
// 因此 node_modules 可原样进 Resources/standalone/，Node 标准 require 解析天然工作，无需 NODE_PATH。
// 之前改名为 app_modules + NODE_PATH 的方案破坏了 Node 模块解析，已废弃。

// 补全 standalone file tracing 漏追踪的包（如 @swc/helpers/_ 子目录）。
// Next.js 的 output file tracing 对「子路径 exports」包的静态分析不全，
// 只复制了 package.json + cjs/，丢弃了 _/ esm/ src/ 等运行时需要的子目录。
patchMissingPackages();

// 重写 server.js 内硬编码的项目绝对路径（outputFileTracingRoot / turbopack.root）。
// Next.js 构建时把构建机器的项目根写入 nextConfig，运行时 require-hook 用它解析
// serverExternalPackages（如 better-sqlite3），导致打包到其他机器后 require 仍回退
// 到原构建目录的 node_modules（ABI 不匹配 + 路径不存在）。改为相对 standalone 目录。
rewriteServerJsPaths();
console.log(`  ✓ server.js 内硬编码项目路径已改写为相对路径`);

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
  // 在 bundle 的 node_modules 内所有 better-sqlite3 副本刷新（物化后 .pnpm + 顶层都有副本）
  const nmDir = path.join(bundle, "node_modules");
  let refreshed = 0;
  const targets = findAllFiles(nmDir, "better_sqlite3.node");
  for (const t of targets) {
    fs.copyFileSync(src, t);
    refreshed++;
  }
  console.log(`  ✓ better-sqlite3（Electron ABI）已刷新 ${refreshed} 处`);
}

/**
 * 把目录树里所有符号链接替换为真实文件/目录的物理复制。
 *
 * 背景：fs.cpSync(dereference:true) 会跟随 symlink 读取文件内容，
 * 但对 symlink 目录项本身仍重建为 symlink（保留 link 而非复制目标）。
 * pnpm 的 node_modules 结构全是 symlink，且指向项目源码目录的绝对路径，
 * 打包到其他机器后这些 symlink 全部失效，导致 require 失败。
 *
 * 本函数先收集所有 symlink（避免边遍历边改破坏遍历），再逐个物化：
 * - symlink 指向文件：复制为真实文件
 * - symlink 指向目录：递归复制为真实目录
 * 物化后 symlink 不复存在，bundle 内全是真实文件，可安全打包迁移。
 */
function materializeSymlinks(rootDir: string): number {
  const symlinks: string[] = [];
  const collect = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      // 用 lstat 判断符号链接（isSymbolicLink）；已在前面物化的目录会被跳过
      if (e.isSymbolicLink()) {
        symlinks.push(full);
      } else if (e.isDirectory()) {
        collect(full);
      }
    }
  };
  collect(rootDir);

  let count = 0;
  for (const link of symlinks) {
    let target: string;
    try {
      target = fs.readlinkSync(link);
    } catch {
      continue; // 已失效或无法读取，跳过
    }
    // 解析为绝对路径（相对 symlink 所在目录）
    const resolved = path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(link), target);
    if (!fs.existsSync(resolved)) {
      // 目标不存在（可能已被物化删除），跳过
      continue;
    }
    const stat = fs.statSync(resolved);
    // 先删 symlink，再复制目标内容到原位置
    fs.rmSync(link);
    if (stat.isDirectory()) {
      fs.cpSync(resolved, link, { recursive: true, dereference: true });
    } else {
      fs.copyFileSync(resolved, link);
    }
    count++;
  }
  return count;
}

/**
 * 重写 server.js 内硬编码的项目绝对路径。
 *
 * Next.js 构建时把构建机器的项目根写入 nextConfig 的两个字段：
 * - outputFileTracingRoot: "/Users/.../InkPress"
 * - turbopack.root:         "/Users/.../InkPress"
 *
 * 运行时 Next 的 require-hook 会用 outputFileTracingRoot 解析 serverExternalPackages
 * （better-sqlite3 等），导致打包到其他机器后仍回退到原构建目录加载模块。
 *
 * 这里把所有出现的项目根路径（root）替换为 "."，让 Next 以 server.js 所在目录为基准解析。
 */
function rewriteServerJsPaths() {
  const serverJs = path.join(bundle, "server.js");
  if (!fs.existsSync(serverJs)) {
    console.warn("  ⚠ server.js 不存在，跳过路径改写");
    return;
  }
  let content = fs.readFileSync(serverJs, "utf8");
  // 转义路径中的正则特殊字符（路径含 / 不需转义，但稳妥起见用 split/join 避免正则）
  content = content.split(root).join(".");
  fs.writeFileSync(serverJs, content, "utf8");
}

/**
 * 补全 standalone file tracing 漏追踪的包内容。
 *
 * Next.js 的 output file tracing 用静态分析（@vercel/nft）追踪 require 链，
 * 但对「子路径 exports」（package.json 的 exports 字段映射，如 @swc/helpers/_/...）
 * 追踪不全：只复制了 package.json + 部分 cjs/，丢弃了 _/ esm/ src/ 等运行时实际加载的子目录。
 *
 * 本函数遍历 bundle 的 node_modules，对每个包：
 * - 在项目 node_modules/.pnpm 里找到同包（按目录名匹配 pkg@version）
 * - 对比两边的文件列表，把项目里有但 bundle 里缺失的子目录/文件补全进去
 *
 * 这样无论 Next.js 追踪漏了什么，都以项目里实际安装的完整内容为准补齐。
 */
function patchMissingPackages(): void {
  const bundleNm = path.join(bundle, "node_modules");
  const bundlePnpm = path.join(bundleNm, ".pnpm");
  const projPnpm = path.join(root, "node_modules", ".pnpm");
  if (!fs.existsSync(bundlePnpm) || !fs.existsSync(projPnpm)) {
    console.warn("  ⚠ 找不到 .pnpm 目录，跳过补全");
    return;
  }

  let patchedPkgs = 0;
  let patchedFiles = 0;
  const bundlePkgs = fs.readdirSync(bundlePnpm).filter((d) => {
    try {
      return fs.statSync(path.join(bundlePnpm, d)).isDirectory();
    } catch {
      return false;
    }
  });

  for (const pkgDir of bundlePkgs) {
    // bundlePnpm 下的目录名形如 @swc+helpers@0.5.15 或 better-sqlite3@12.11.1
    const projPkgDir = path.join(projPnpm, pkgDir);
    const bundlePkgDir = path.join(bundlePnpm, pkgDir);
    if (!fs.existsSync(projPkgDir)) continue;

    // 包内真实的包文件在 node_modules/<pkg名>/ 下（pnpm 结构）
    const projPkgNm = path.join(projPkgDir, "node_modules");
    const bundlePkgNm = path.join(bundlePkgDir, "node_modules");
    if (!fs.existsSync(projPkgNm) || !fs.existsSync(bundlePkgNm)) continue;

    // 遍历包内 node_modules 下的每个子包，补全缺失文件
    let pkgChanged = false;
    for (const subPkg of fs.readdirSync(projPkgNm)) {
      if (subPkg === ".pnpm") continue;
      const projSub = path.join(projPkgNm, subPkg);
      const bundleSub = path.join(bundlePkgNm, subPkg);
      if (!fs.statSync(projSub).isDirectory()) continue;

      // bundle 里可能缺这个子包，或子包内容不全
      const before = countFiles(bundleSub);
      mergeDir(projSub, bundleSub);
      const after = countFiles(bundleSub);
      if (after > before) {
        patchedFiles += after - before;
        pkgChanged = true;
      }
    }
    if (pkgChanged) patchedPkgs++;
  }

  console.log(
    `  ✓ 补全 standalone 漏追踪的包内容：${patchedPkgs} 个包，${patchedFiles} 个文件`
  );
}

/** 把 src 目录的内容合并到 dest（只补 dest 缺失的文件，不覆盖已有的） */
function mergeDir(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.cpSync(src, dest, { recursive: true, dereference: true });
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      mergeDir(s, d);
    } else if (e.isFile() && !fs.existsSync(d)) {
      fs.copyFileSync(s, d);
    }
  }
}

/** 统计目录下文件总数（递归） */
function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) count++;
    }
  };
  walk(dir);
  return count;
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
