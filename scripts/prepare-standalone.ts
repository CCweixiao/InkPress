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
 * - resources/skills/system、themes、prisma/migrations（运行时 fs 读取的只读资源）
 * - better_sqlite3.node 原生绑定（确保顶层 + .pnpm 一致）
 *
 * 运行：pnpm tsx scripts/prepare-standalone.ts（在 pnpm build 之后）
 *
 * 目标 CPU 架构（better-sqlite3 原生绑定必须与 electron-builder --arch 一致）：
 * - 环境变量 INKPRESS_TARGET_ARCH=arm64|x64（electron-build.mjs 注入）
 * - CLI 参数 --arm64 | --x64
 * - 默认：process.arch
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire, builtinModules } from "node:module";

/**
 * 跨平台递归复制（跟随 symlink/junction 物化为真实文件）。
 *
 * 不能直接用 fs.cpSync(..., { dereference: true })：
 * Windows 上 Node 22 的 fs.cpSync 对 pnpm 的 .pnpm junction 结构处理时会触发
 * STATUS_STACK_BUFFER_OVERRUN（exit code 3221226505 = 0xC0000409），native crash。
 * 已知问题：https://github.com/nodejs/node/issues/53855 系列。
 *
 * Windows 分流为手动递归复制（lstat + readlink + stat），逐个文件 copyFile，
 * 避开 fs.cpSync 的 dereference 路径。其他平台保留原 fs.cpSync（性能更好）。
 */
function safeCpSync(src: string, dest: string): void {
  if (process.platform === "win32") {
    copyTreeFollowingLinks(src, dest);
  } else {
    fs.cpSync(src, dest, { recursive: true, dereference: true });
  }
}

/** 手动递归复制：跟随 symlink/junction 复制 target 内容（Windows 专用）。 */
function copyTreeFollowingLinks(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isSymbolicLink()) {
      let target: string;
      try {
        target = fs.readlinkSync(s);
      } catch {
        continue;
      }
      const resolved = path.isAbsolute(target) ? target : path.resolve(path.dirname(s), target);
      if (!fs.existsSync(resolved)) continue;
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        copyTreeFollowingLinks(resolved, d);
      } else {
        fs.copyFileSync(resolved, d);
      }
    } else if (e.isDirectory()) {
      copyTreeFollowingLinks(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

const root = process.cwd();
const targetArch = parseTargetArch();

/** 解析打包目标 CPU 架构（与 electron-builder --arm64/--x64 对齐） */
function parseTargetArch(): "arm64" | "x64" {
  const fromEnv = process.env.INKPRESS_TARGET_ARCH;
  if (fromEnv === "arm64" || fromEnv === "x64") return fromEnv;

  const flag = process.argv.find((a) => a === "--arm64" || a === "--x64");
  if (flag === "--arm64") return "arm64";
  if (flag === "--x64") return "x64";

  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x64";

  console.error(`✗ 不支持的本机架构：${process.arch}，请设置 INKPRESS_TARGET_ARCH=arm64|x64`);
  process.exit(1);
}

/** lipo 架构名：x64 → x86_64 */
function machArchLabel(arch: "arm64" | "x64"): string {
  return arch === "x64" ? "x86_64" : "arm64";
}
const srcStandalone = path.join(root, ".next", "standalone");
// 去符号链接的 bundle 目录（electron-builder 的 extraResources 指向此处）
const bundle = path.join(root, ".next", "standalone-bundle");

// Next.js serverExternalPackages（next.config.ts）+ 原生模块
// 这些包不参与 esbuild bundle，运行时从 node_modules 加载
const SERVER_EXTERNALS = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", "server-externals.json"), "utf8")
) as string[];

if (!fs.existsSync(srcStandalone)) {
  console.error("✗ .next/standalone 不存在，请先执行 pnpm build（需 output: standalone）");
  process.exit(1);
}

// 清理旧 bundle，重建
fs.rmSync(bundle, { recursive: true, force: true });

console.log(`生成去符号链接的 standalone bundle（目标架构 ${targetArch}）…`);
// 第一步：只复制 Next standalone 的标准运行时根项。Turbopack 对动态 fs 路径会把
// storage、旧 dist、测试甚至整个工作区保守追踪进 standalone；先全量复制再删除会在
// Windows/macOS 产生数百 MB 到数 GB 的无效 I/O，也可能短暂复制敏感本地数据。
copyAllowedStandaloneRoots();
// 第二步：把残留的符号链接全部物化为真实文件（关键修复）
const materialized = materializeSymlinks(bundle);
console.log(
  `  ✓ standalone → ${path.relative(root, bundle)}（已解析符号链接，物化 ${materialized} 处 symlink → 真实文件）`
);

// Next.js NFT 会把构建机项目根下与动态 fs 路径相关的任意内容带进 standalone，
// 包括本地数据库、.env、服务端子项目甚至私钥。这里采用根目录 allowlist，
// 只保留 Next standalone 的四个标准入口；业务只读资源在后面从受控源重新复制。
pruneUnexpectedBundleRoots();

function copyAllowedStandaloneRoots(): void {
  const allowed = [".next", "node_modules", "server.js", "package.json"];
  fs.mkdirSync(bundle, { recursive: true });
  for (const name of allowed) {
    const source = path.join(srcStandalone, name);
    const destination = path.join(bundle, name);
    if (!fs.existsSync(source)) {
      console.error(`  ✗ standalone 缺少标准运行时根项：${name}`);
      process.exit(1);
    }
    const stat = fs.statSync(source);
    if (stat.isDirectory()) safeCpSync(source, destination);
    else fs.copyFileSync(source, destination);
  }
  const skipped = fs.readdirSync(srcStandalone).filter((name) => !allowed.includes(name));
  let reclaimedBytes = 0;
  for (const name of skipped) {
    const tracedCopy = path.join(srcStandalone, name);
    reclaimedBytes += measureSize(tracedCopy);
    // 这里只删除 Next 生成在 .next/standalone 下的副本，绝不触碰项目根的原始数据。
    fs.rmSync(tracedCopy, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 3 : 0,
      retryDelay: 100,
    });
  }
  console.log(
    `  ✓ 根目录白名单复制 4 项，跳过并清理 ${skipped.length} 个误追踪副本` +
      `（约 ${(reclaimedBytes / 1024 / 1024).toFixed(1)} MB）`
  );
}

// 注：node_modules 保留原名（不改名 app_modules）。
// extraResources 不受 build.files 规则的 "!**/node_modules/**" 约束（那仅作用于 app.asar 内部），
// 因此 node_modules 可原样进 Resources/standalone/，Node 标准 require 解析天然工作，无需 NODE_PATH。
// 之前改名为 app_modules + NODE_PATH 的方案破坏了 Node 模块解析，已废弃。

// 补全 standalone file tracing 漏追踪的包（如 @swc/helpers/_ 子目录）。
// Next.js 的 output file tracing 对「子路径 exports」包的静态分析不全，
// 只复制了 package.json + cjs/，丢弃了 _/ esm/ src/ 等运行时需要的子目录。
patchMissingPackages();

// 提升 .pnpm/node_modules/ 虚拟根内容到顶层 node_modules/，确保 require 解析可达。
// pnpm 的依赖解析依赖符号链接：顶层 next/ 是指向 .pnpm/next@*/node_modules/next/ 的
// symlink，其依赖 @swc/helpers 在虚拟存储的兄弟目录下。materializeSymlinks 把 symlink
// 物化为真实目录后，顶层 next/ 变成独立目录，兄弟解析路径断裂，导致 require('@swc/helpers')
// 找不到模块。这里从项目 .pnpm/node_modules/ 补全 bundle 的虚拟根，再把缺失的包提升到顶层。
hoistMissingTopLevel();

// Next.js .next/node_modules/<pkg>-<hash>/ 里的 traced 包会按自己的目录解析依赖。
// 若只把依赖提升到顶层，遇到同名多版本包（如 jsdom 需要 lru-cache@11，
// 顶层另有 lru-cache@5）会解析到错误版本。这里为 traced 包物化局部依赖闭包。
materializeTracedNextPackageDependencies();
// 兜底：递归扫描所有 traced 包（含深层嵌套），从 .pnpm/ 源补齐 NFT 遗漏的文件。
// NFT 对 @exodus/bytes/fallback/single-byte.encodings.js 等文件的追踪不全，
// 仅靠 copyRuntimeDeps 的依赖链解析有时无法覆盖到深层嵌套包。
patchAllTracedPackageGaps();

// 重写 server.js 内硬编码的项目绝对路径（outputFileTracingRoot / turbopack.root）。
// Next.js 构建时把构建机器的项目根写入 nextConfig，运行时 require-hook 用它解析
// serverExternalPackages（如 better-sqlite3），导致打包到其他机器后 require 仍回退
// 到原构建目录的 node_modules（ABI 不匹配 + 路径不存在）。改为相对 standalone 目录。
rewriteServerJsPaths();
console.log(`  ✓ server.js 内硬编码项目路径已改写为相对路径`);
rewriteRequiredServerFilesPaths();

function copyInto(src: string, destRel: string, label: string) {
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠ 跳过 ${label}：源不存在 ${path.relative(root, src)}`);
    return;
  }
  const dest = path.join(bundle, destRel);
  safeCpSync(src, dest);
  console.log(`  ✓ ${label} → ${destRel}`);
}

// 1. 前端静态资源（standalone 不含）
copyInto(path.join(root, ".next", "static"), path.join(".next", "static"), ".next/static");
copyInto(path.join(root, "public"), "public", "public");

// 2. 只读资源（系统 skill 只读原件 + 内置主题）
copyInto(
  path.join(root, "resources", "skills", "system"),
  path.join("resources", "skills", "system"),
  "resources/skills/system"
);
copyInto(path.join(root, "themes"), "themes", "themes");

// 3. Prisma migrations（首次启动建表用）
copyInto(path.join(root, "prisma", "migrations"), "migrations", "prisma/migrations");

// 4. better-sqlite3 原生绑定：为 Electron ABI 重新编译（ELECTRON_RUN_AS_NODE 下
//    Electron 42 的 Node ABI=146，与标准 Node 22 的 prebuilt ABI=127 不匹配）。
//    跨平台分发：darwin 走 Mach-O 校验，win32 跳过（无 file 命令且 .node 是 PE 格式）。
ensureNativeBindingForElectron();

// 6-10. esbuild bundle + prune + slimBundle + bytecode（esbuild build 异步，用 IIFE 包装）
void (async () => {
  // 6. esbuild bundle：把 925 MB node_modules 压成单个 server.bundle.js
  await bundleServerJs();
  // 7. 删除 bundle 已内联的 node_modules（保留 externals 及其依赖闭包）
  pruneBundledNodeModules();
  // 8. 显式补齐当前平台的原生运行时包（Claude CLI / Resvg），缺失即失败
  ensurePlatformRuntimePackages();
  // 9. 瘦身：剔除 externals 残留的测试、声明、源码映射等
  slimBundle();
  // 所有 merge/copy 完成后再物化一次，杜绝后续步骤重新引入 pnpm 悬空链接
  const finalMaterialized = materializeSymlinks(bundle);
  if (finalMaterialized > 0) {
    console.log(`  ✓ 最终物化 ${finalMaterialized} 处运行时 symlink`);
  }
  // Next 16 的 Turbopack NFT 会漏掉 jsdom 深层 ESM 文件；在所有裁剪和物化结束后
  // 逐一修复并验证，确保真正写入安装包的最终目录可直接加载。
  ensureCriticalTracedRuntimeFiles();
  // 10. 复制 bytenode 到 bundle/node_modules（运行时薄加载器 require('bytenode') 用）
  ensureBytenodeInBundle();
  // 11. server.js → server.jsc + 薄加载器（V8 字节码保护，防逆向）
  compileBytecode();
  // 12. 完整性门禁：入口、原生架构、平台包、无符号链接/开发目录
  verifyPreparedBundle();
  console.log("✓ standalone bundle 准备完成：" + path.relative(root, bundle));
})().catch((err) => {
  console.error("✗ prepare-standalone 失败:", err);
  process.exit(1);
});

/**
 * 为 Electron ABI 重新编译 bundle 内的 better-sqlite3。
 *
 * ELECTRON_RUN_AS_NODE=1 下，Electron 42 内嵌 Node 的 ABI=146，
 * 而 better-sqlite3 官方 prebuilt 针对标准 Node（ABI=127），两者不匹配。
 * 用 @electron/rebuild 针对当前 electron 版本重新编译原生绑定。
 *
 * 注意：必须在 bundle/node_modules 上跑（而非项目 node_modules），
 * 避免 electron-rebuild 把开发环境里的标准 Node ABI 绑定改成 Electron ABI。
 */
function ensureNativeBindingForElectron() {
  prepareBetterSqliteSourceForRebuild();
  if (process.platform === "darwin") {
    ensureNativeBindingForElectronDarwin();
    return;
  }
  if (process.platform === "win32") {
    ensureNativeBindingForElectronWindows();
    return;
  }
  console.error(
    `  ✗ 不支持的平台：${process.platform}（prepare-standalone 仅支持 darwin / win32）`
  );
  process.exit(1);
}

/** NFT 顶层副本只有运行时文件；重编前用项目完整源码包替换 bundle 副本。 */
function prepareBetterSqliteSourceForRebuild(): void {
  const src = path.join(root, "node_modules", "better-sqlite3");
  const dest = path.join(bundle, "node_modules", "better-sqlite3");
  if (!fs.existsSync(path.join(src, "binding.gyp"))) {
    console.error("  ✗ 项目 better-sqlite3 缺少 binding.gyp，无法为 Electron 重编");
    process.exit(1);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  safeCpSync(src, dest);
  if (!fs.existsSync(path.join(dest, "binding.gyp"))) {
    console.error("  ✗ better-sqlite3 完整源码复制到 bundle 失败");
    process.exit(1);
  }
}

/**
 * macOS：electron-rebuild 重编 + Mach-O 架构校验（依赖 `file` 命令）。
 *
 * 必须重编：ELECTRON_RUN_AS_NODE=1 下 Electron 42 内嵌 Node ABI=146，
 * 而 better-sqlite3 官方 prebuilt 针对标准 Node（ABI=127），两者不匹配。
 * 用 @electron/rebuild 针对当前 electron 版本重新编译原生绑定。
 *
 * 注意：必须在 bundle/node_modules 上跑（而非项目 node_modules），
 * 避免 electron-rebuild 把开发环境里的标准 Node ABI 绑定改成 Electron ABI。
 */
function ensureNativeBindingForElectronDarwin() {
  console.log(`  → 为 Electron 重编译 better-sqlite3 原生绑定（darwin, arch=${targetArch}）…`);

  // 直接在 bundle/node_modules 内重编译，避免污染开发环境中的 Node ABI 绑定。
  const electronVersion = JSON.parse(
    fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8")
  ).version;

  const rebuildBin = path.join(root, "node_modules", ".bin", "electron-rebuild");
  const rebuildAppDir = bundle;
  const result = spawnSync(
    rebuildBin,
    [
      "-f",
      "-w",
      "better-sqlite3",
      "--module-dir",
      rebuildAppDir,
      "--version",
      electronVersion,
      "--arch",
      targetArch,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        npm_config_runtime: "electron",
        npm_config_target: electronVersion,
        npm_config_arch: targetArch,
        npm_config_disturl: "https://electronjs.org/headers",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    console.error(
      `  ✗ electron-rebuild 失败（退出码 ${result.status}，arch=${targetArch}）。` +
        ` 跨架构打包请在对应 CPU 的 Mac 上构建，或检查 Xcode CLT。`
    );
    process.exit(1);
  }

  // 把重编译后的顶层 .node 复制到 bundle 的所有 better-sqlite3 副本
  const src = path.join(
    path.join(bundle, "node_modules"),
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
  );
  if (!fs.existsSync(src)) {
    console.error(
      `  ✗ bundle node_modules 找不到 arch=${targetArch} 的 better_sqlite3.node`
    );
    process.exit(1);
  }

  verifyNodeArch(src, targetArch);

  // 扫描整个 bundle 刷新所有 better_sqlite3.node 副本：
  // - node_modules/{better-sqlite3,.pnpm/better-sqlite3@*}/...（常规路径）
  // - .next/node_modules/better-sqlite3-*/...（Next.js nft 追踪生成的带哈希副本，运行时优先命中）
  let refreshed = 0;
  const targets = findAllFiles(bundle, "better_sqlite3.node");
  if (targets.length === 0) {
    console.error("  ✗ bundle 中没有 better_sqlite3.node，无法生成完整安装包");
    process.exit(1);
  }
  for (const t of targets) {
    if (path.resolve(t) !== path.resolve(src)) fs.copyFileSync(src, t);
    verifyNodeArch(t, targetArch);
    refreshed++;
  }
  console.log(
    `  ✓ better-sqlite3（Electron ABI，${targetArch}）已刷新 ${refreshed} 处`
  );
}

/**
 * Windows：electron-rebuild 重编 + 直接复制到 bundle 副本（不做 Mach-O 校验）。
 *
 * 跟 darwin 的差异：
 * - 不调 detectMachArchs / verifyNodeArch：Windows 上 `file` 命令不存在，
 *   且 .node 是 PE 格式不是 Mach-O，无法用 Mach-O 检测命令验证架构
 * - electron-rebuild 调用走 shell（Windows .bin 是 .cmd 包装器，
 *   spawnSync 默认 shell=false 调用 .cmd 会失败）
 * - 直接校验重编产物的 PE machine 字段，阻止 x64/arm64 混包
 */
function ensureNativeBindingForElectronWindows() {
  console.log(`  → 为 Electron 重编译 better-sqlite3 原生绑定（win32, arch=${targetArch}）…`);

  const electronVersion = JSON.parse(
    fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8")
  ).version;

  // Windows .bin/electron-rebuild 是 .cmd 包装器，必须 shell:true 让 spawn 解析 .cmd
  const rebuildBin = path.join(root, "node_modules", ".bin", "electron-rebuild");
  const rebuildAppDir = bundle;
  const result = spawnSync(
    rebuildBin,
    [
      "-f",
      "-w",
      "better-sqlite3",
      "--module-dir",
      rebuildAppDir,
      "--version",
      electronVersion,
      "--arch",
      targetArch,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        npm_config_runtime: "electron",
        npm_config_target: electronVersion,
        npm_config_arch: targetArch,
        npm_config_disturl: "https://electronjs.org/headers",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    console.error(
      `  ✗ electron-rebuild 失败（退出码 ${result.status}，win32-${targetArch}）。` +
        ` 检查 Windows Build Tools（python3 + VS Build Tools）是否就绪。`
    );
    process.exit(1);
  }

  // 使用 bundle 顶层刚重编的绑定；随后用 PE machine 字段验证 x64/arm64。
  const src = path.join(
    path.join(bundle, "node_modules"),
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
  );
  if (!fs.existsSync(src)) {
    console.error(
      `  ✗ bundle node_modules 找不到 better_sqlite3.node（electron-rebuild 应已产出）`
    );
    process.exit(1);
  }

  // 复制到 bundle 的所有 better-sqlite3 副本
  let refreshed = 0;
  const targets = findAllFiles(bundle, "better_sqlite3.node");
  if (targets.length === 0) {
    console.error("  ✗ bundle 中没有 better_sqlite3.node，无法生成完整安装包");
    process.exit(1);
  }
  for (const t of targets) {
    if (path.resolve(t) !== path.resolve(src)) fs.copyFileSync(src, t);
    verifyPeArch(t, targetArch);
    refreshed++;
  }
  console.log(
    `  ✓ better-sqlite3（Electron ABI，win32-${targetArch}）已刷新 ${refreshed} 处`
  );
}

/**
 * 检测 Mach-O 文件包含的 CPU 架构列表。
 *
 * macOS 26.x (Tahoe) 上 lipo 对部分 .node 文件会触发 SIGKILL（exit 137），
 * 无法可靠检测架构。改用 `file -b` 读取 Mach-O 描述文本，从中匹配 arm64 / x86_64。
 */
function detectMachArchs(nodePath: string): string[] {
  const r = spawnSync("file", ["-b", nodePath], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return [];
  const out = r.stdout.toLowerCase();
  const archs: string[] = [];
  if (out.includes("arm64")) archs.push("arm64");
  if (out.includes("x86_64")) archs.push("x86_64");
  return archs;
}

/** 在 node_modules 树中查找与目标架构匹配的 better_sqlite3.node */
function findNativeBindingForArch(
  nmRoot: string,
  arch: "arm64" | "x64"
): string | null {
  const candidates = findAllFiles(nmRoot, "better_sqlite3.node");
  const expected = machArchLabel(arch);
  for (const candidate of candidates) {
    const actual = detectMachArchs(candidate);
    if (actual.includes(expected)) return candidate;
  }
  return null;
}

/** 校验 .node 文件的 CPU 架构，不匹配则终止打包 */
function verifyNodeArch(nodePath: string, arch: "arm64" | "x64"): void {
  const expected = machArchLabel(arch);
  const actual = detectMachArchs(nodePath);
  if (actual.length === 0) {
    console.warn(`  ⚠ 无法验证 ${path.relative(root, nodePath)} 的 CPU 架构`);
    return;
  }
  if (!actual.includes(expected)) {
    console.error(
      `  ✗ ${path.relative(root, nodePath)} 架构不匹配：期望 ${expected}，实际 ${actual.join(", ") || "未知"}`
    );
    process.exit(1);
  }
}

/** 读取 Windows PE/COFF machine 字段并校验目标架构。 */
function verifyPeArch(binaryPath: string, arch: "arm64" | "x64"): void {
  let fd: number;
  try {
    fd = fs.openSync(binaryPath, "r");
  } catch (error) {
    console.error(`  ✗ 无法读取 PE 文件 ${path.relative(root, binaryPath)}: ${String(error)}`);
    process.exit(1);
  }
  try {
    const dos = Buffer.alloc(64);
    if (fs.readSync(fd!, dos, 0, dos.length, 0) !== dos.length || dos.readUInt16LE(0) !== 0x5a4d) {
      console.error(`  ✗ ${path.relative(root, binaryPath)} 不是有效 PE 文件（缺少 MZ）`);
      process.exit(1);
    }
    const peOffset = dos.readUInt32LE(0x3c);
    const pe = Buffer.alloc(6);
    if (
      fs.readSync(fd!, pe, 0, pe.length, peOffset) !== pe.length ||
      pe.toString("ascii", 0, 4) !== "PE\0\0"
    ) {
      console.error(`  ✗ ${path.relative(root, binaryPath)} 不是有效 PE 文件（缺少 PE header）`);
      process.exit(1);
    }
    const actual = pe.readUInt16LE(4);
    const expected = arch === "arm64" ? 0xaa64 : 0x8664;
    if (actual !== expected) {
      console.error(
        `  ✗ ${path.relative(root, binaryPath)} PE 架构不匹配：期望 0x${expected.toString(16)}，实际 0x${actual.toString(16)}`
      );
      process.exit(1);
    }
  } finally {
    fs.closeSync(fd!);
  }
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
      safeCpSync(resolved, link);
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
  // Windows 路径写进 JS 字符串后反斜杠会变成 `\\`；同时兼容 Next 使用 POSIX
  // 分隔符序列化的情况，避免 macOS 校验通过而 Windows 留下构建机路径。
  for (const variant of buildRootVariants()) content = content.split(variant).join(".");
  if (textContainsBuildRoot(content)) {
    console.error("  ✗ server.js 仍包含构建机绝对路径");
    process.exit(1);
  }
  fs.writeFileSync(serverJs, content, "utf8");
}

/** 把 Next 运行时元数据中的构建机绝对路径改为 bundle cwd 下的相对路径。 */
function rewriteRequiredServerFilesPaths(): void {
  const metadata = path.join(bundle, ".next", "required-server-files.json");
  if (!fs.existsSync(metadata)) {
    console.error("  ✗ .next/required-server-files.json 不存在，无法生成可迁移 bundle");
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(metadata, "utf8"));
  const rewritten = replaceBuildRootInValue(parsed);
  if (valueContainsBuildRoot(rewritten)) {
    console.error("  ✗ required-server-files.json 仍包含构建机绝对路径");
    process.exit(1);
  }
  fs.writeFileSync(metadata, JSON.stringify(rewritten), "utf8");
  console.log("  ✓ required-server-files.json 构建机路径已改写");
}

function buildRootVariants(): string[] {
  return [
    root,
    root.split(path.sep).join("/"),
    JSON.stringify(root).slice(1, -1),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
}

function textContainsBuildRoot(value: string): boolean {
  return buildRootVariants().some((variant) => value.includes(variant));
}

function replaceBuildRootInValue(value: unknown): unknown {
  if (typeof value === "string") {
    let result = value;
    // JSON.parse 已还原反斜杠，只需处理原生与 POSIX 两种路径表示。
    for (const variant of [root, root.split(path.sep).join("/")]) {
      result = result.split(variant).join(".");
    }
    return result;
  }
  if (Array.isArray(value)) return value.map(replaceBuildRootInValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, replaceBuildRootInValue(nested)])
    );
  }
  return value;
}

function valueContainsBuildRoot(value: unknown): boolean {
  if (typeof value === "string") {
    return [root, root.split(path.sep).join("/")].some((variant) => value.includes(variant));
  }
  if (Array.isArray(value)) return value.some(valueContainsBuildRoot);
  if (value && typeof value === "object") {
    return Object.values(value).some(valueContainsBuildRoot);
  }
  return false;
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

/**
 * 提升 .pnpm/node_modules/ 虚拟根中缺失的包到顶层 node_modules/。
 *
 * pnpm 用符号链接实现依赖隔离：顶层 next 指向 .pnpm 虚拟存储中的真实位置，
 * 其依赖 @swc/helpers 以兄弟目录形式存在于同一个虚拟包目录内。
 *
 * materializeSymlinks 把符号链接物化为真实目录后，next 变成独立的顶层目录，
 * require('@swc/helpers') 从 node_modules/next 向上查找时只会找
 * node_modules/@swc/helpers，而该路径从未被创建（standalone 只输出直接依赖）。
 *
 * 本函数用 BFS 遍历顶层包的依赖树，仅提升运行时实际需要的包（而非全部虚拟根内容），
 * 避免引入 dev/test 依赖导致体积膨胀。源从项目虚拟根补全后的 bundle 虚拟根获取。
 */
function hoistMissingTopLevel(): void {
  const bundleNm = path.join(bundle, "node_modules");
  const projVirtualRoot = path.join(root, "node_modules", ".pnpm", "node_modules");
  const bundleVirtualRoot = path.join(bundleNm, ".pnpm", "node_modules");
  if (!fs.existsSync(projVirtualRoot)) return;

  // BFS：从顶层已有包出发，沿 dependencies 边遍历，仅提升/补全运行时依赖。
  // 不再全量复制项目虚拟根（上千个 pnpm symlink、GB 级 I/O）；每个实际需要的包按需 merge。
  const queue: string[] = [];
  const collectTopLevel = (dir: string, prefix = "") => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".pnpm" || e.name.startsWith(".")) continue;
      if (!fs.statSync(path.join(dir, e.name)).isDirectory()) continue;
      if (e.name.startsWith("@") && !prefix) {
        collectTopLevel(path.join(dir, e.name), e.name + "/");
      } else {
        queue.push(prefix + e.name);
      }
    }
  };
  collectTopLevel(bundleNm);

  // 收集所有已知包（顶层 + nft 追踪）的 dependencies，作为 BFS 的需求来源。
  // nft 追踪的包（.next/node_modules/<pkg>-<hash>/）运行时从 .next/ 向上解析依赖，
  // 最终回退到顶层 node_modules/，因此其依赖也必须存在于顶层。
  const requiredDeps = new Set<string>();
  const scanDeps = (pkgDir: string) => {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
      for (const dep of Object.keys(pj.dependencies || {})) requiredDeps.add(dep);
    } catch {
      /* ignore */
    }
  };
  // 顶层包
  for (const pkg of queue) scanDeps(path.join(bundleNm, pkg));
  // nft 追踪包（.next/node_modules/<pkg>-<hash>/ 或 @scope/<pkg>-<hash>/）
  const nextNm = path.join(bundle, ".next", "node_modules");
  if (fs.existsSync(nextNm)) {
    for (const e of fs.readdirSync(nextNm)) {
      if (e.startsWith("@")) {
        // scoped package: @org/ 下递归一层
        const scopeDir = path.join(nextNm, e);
        for (const sub of fs.readdirSync(scopeDir)) {
          scanDeps(path.join(scopeDir, sub));
        }
      } else {
        scanDeps(path.join(nextNm, e));
      }
    }
  }

  const seen = new Set(queue);
  let hoisted = 0;
  // 把 requiredDeps 加入队列（这些是某些包声明但可能不在顶层的依赖）
  for (const dep of requiredDeps) {
    if (!seen.has(dep)) {
      seen.add(dep);
      queue.push(dep);
    }
  }
  while (queue.length > 0) {
    const pkg = queue.shift()!;
    let pkgDir = path.join(bundleNm, pkg);
    const projectTopLevel = path.join(root, "node_modules", pkg);
    const projectSource = path.join(projVirtualRoot, pkg);
    const bundleSource = path.join(bundleVirtualRoot, pkg);
    const srcDep = fs.existsSync(projectTopLevel)
      ? projectTopLevel
      : fs.existsSync(projectSource)
        ? projectSource
        : bundleSource;
    if (!fs.existsSync(srcDep)) continue;
    const wasMissing = !fs.existsSync(pkgDir);
    fs.mkdirSync(path.dirname(pkgDir), { recursive: true });
    mergeDir(srcDep, pkgDir);
    if (wasMissing) hoisted++;
    // 读取 dependencies 继续 BFS
    let deps: string[] = [];
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
      deps = Object.keys(pj.dependencies || {});
    } catch {
      continue;
    }
    for (const dep of deps) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      queue.push(dep);
    }
  }
  if (hoisted > 0) {
    console.log(`  ✓ 从 .pnpm 虚拟根提升 ${hoisted} 个缺失包到顶层 node_modules`);
  }
}

/**
 * 给 .next/node_modules/<pkg>-<hash>/ 包补齐局部依赖闭包。
 *
 * Turbopack runtime 会 externalRequire("jsdom-<hash>")，后续 require("lru-cache")
 * 从这个 traced 包目录向上解析。只提升到顶层会破坏 pnpm 的多版本隔离：
 * jsdom@29 需要 lru-cache@11，但顶层可能已有旧版 lru-cache@5。
 *
 * 解决方式：找到项目 node_modules 中对应真实包，用它自己的 require 解析 dependencies，
 * 递归复制到 traced 包的 node_modules 下，保留局部版本选择。
 */
function materializeTracedNextPackageDependencies(): void {
  const nextNm = path.join(bundle, ".next", "node_modules");
  if (!fs.existsSync(nextNm)) return;

  const projectRequire = createRequire(path.join(root, "package.json"));
  const seen = new Set<string>();
  let tracedPackages = 0;
  let copiedPackages = 0;

  const tracedPackageDirs = (dir: string, scope = ""): string[] => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const result: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name.startsWith("@") && !scope) {
        result.push(...tracedPackageDirs(full, e.name + "/"));
        continue;
      }
      if (fs.existsSync(path.join(full, "package.json"))) result.push(full);
    }
    return result;
  };

  const readPackageJson = (pkgDir: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    } catch {
      return null;
    }
  };

  const resolvePackageDir = (
    req: NodeRequire,
    pkgName: string
  ): string | null => {
    const normalizedName = pkgName.startsWith("node:") ? pkgName.slice(5) : pkgName;
    if (builtinModules.includes(normalizedName)) return null;

    let entry: string;
    try {
      entry = req.resolve(pkgName);
    } catch {
      return null;
    }
    if (!path.isAbsolute(entry)) return null;

    let dir = fs.statSync(entry).isDirectory() ? entry : path.dirname(entry);
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, "package.json"))) return dir;
      dir = path.dirname(dir);
    }
    return null;
  };

  const copyRuntimeDeps = (srcPkgDir: string, destPkgDir: string) => {
    const key = `${srcPkgDir}=>${destPkgDir}`;
    if (seen.has(key)) return;
    seen.add(key);

    const pj = readPackageJson(srcPkgDir);
    if (!pj) return;
    const deps = [
      ...Object.keys((pj.dependencies as Record<string, unknown> | undefined) || {}),
      ...Object.keys((pj.optionalDependencies as Record<string, unknown> | undefined) || {}),
    ];
    if (deps.length === 0) return;

    const srcRequire = createRequire(path.join(srcPkgDir, "package.json"));
    for (const dep of deps) {
      const srcDepDir = resolvePackageDir(srcRequire, dep);
      if (!srcDepDir) continue;
      const destDepDir = path.join(destPkgDir, "node_modules", dep);
      fs.mkdirSync(path.dirname(destDepDir), { recursive: true });
      if (!fs.existsSync(destDepDir)) {
        safeCpSync(srcDepDir, destDepDir);
        copiedPackages++;
      } else {
        // NFT 可能已创建"存在但残缺"的目录（如 @exodus/bytes 只追踪了
        // single-byte.js 但漏了 single-byte.encodings.js）。用 mergeDir
        // 补齐缺失文件，而非因目录存在就跳过。
        mergeDir(srcDepDir, destDepDir);
      }
      copyRuntimeDeps(srcDepDir, destDepDir);
    }
  };

  for (const tracedDir of tracedPackageDirs(nextNm)) {
    const pj = readPackageJson(tracedDir);
    const name = typeof pj?.name === "string" ? pj.name : null;
    if (!name) continue;

    const srcPkgDir = resolvePackageDir(projectRequire, name);
    if (!srcPkgDir) continue;
    tracedPackages++;
    // NFT 对外部包有时只追踪到当前路由静态可见的文件。包内生成代码若通过
    // 相对路径延迟 require（jsdom 的 generated/idl → living/webstorage 即为此类），
    // 目标文件不会出现在 trace 中，最终安装包会在路由加载时直接 500。
    // 先把对应真实包的运行时文件完整补进 traced 目录，再补它的依赖闭包。
    mergeDir(srcPkgDir, tracedDir);
    copyRuntimeDeps(srcPkgDir, tracedDir);
  }

  if (tracedPackages > 0) {
    console.log(
      `  ✓ 补齐 .next traced 包局部依赖：${tracedPackages} 个 traced 包，复制 ${copiedPackages} 个依赖包`
    );
  }
}

/**
 * 兜底：递归扫描 .next/node_modules/ 下所有包目录（包括深层嵌套的
 * jsdom/node_modules/html-encoding-sniffer/node_modules/@exodus/bytes 等），
 * 从 .pnpm/ 源目录 mergeDir 补齐 NFT 遗漏的文件。
 *
 * NFT 对部分包（如 @exodus/bytes）只追踪了 single-byte.js 但漏掉了
 * single-byte.encodings.js（静态 ESM import 却没被 trace 到）。
 * materializeTracedNextPackageDependencies 的 copyRuntimeDeps 依赖依赖链
 * 解析，深层嵌套包可能被 seen 集合跳过。本函数直接在文件系统层面
 * 按包名+版本从 .pnpm/ 定位源目录，对每个包 mergeDir 补缺。
 */
function patchAllTracedPackageGaps(): void {
  const nextNm = path.join(bundle, ".next", "node_modules");
  if (!fs.existsSync(nextNm)) return;

  const pnpmDir = path.join(root, "node_modules", ".pnpm");
  const sourceCache = new Map<string, string>();

  const findSourceInPnpm = (name: string, version?: string): string | null => {
    // 同名包可以在 pnpm 虚拟存储中共存多个版本；必须按 name + version 匹配，
    // 否则会把另一个版本的不完整依赖树复制进 traced 包。
    const cacheKey = `${name}@${version || ""}`;
    if (sourceCache.has(cacheKey)) {
      const cached = sourceCache.get(cacheKey)!;
      return cached || null;
    }
    try {
      const entries = fs.readdirSync(pnpmDir, { withFileTypes: true });
      const escapedName = name.replace("/", "+");
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const matchesPackage = version
          ? e.name.startsWith(`${escapedName}@${version}`)
          : e.name.startsWith(escapedName + "@");
        if (matchesPackage || e.name === escapedName) {
          const pkgDir = path.join(pnpmDir, e.name, "node_modules", name);
          if (fs.existsSync(path.join(pkgDir, "package.json"))) {
            sourceCache.set(cacheKey, pkgDir);
            return pkgDir;
          }
        }
      }
    } catch {
      /* .pnpm/ not readable */
    }
    sourceCache.set(cacheKey, "");
    return null;
  };

  let patchedFiles = 0;

  const walkAndPatch = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory();
      if (!isDir && e.isSymbolicLink()) {
        try {
          isDir = fs.statSync(full).isDirectory();
        } catch {
          continue;
        }
      }
      if (!isDir) continue;

      const pjPath = path.join(full, "package.json");
      if (fs.existsSync(pjPath)) {
        try {
          const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
          if (typeof pj.name === "string") {
            const srcDir = findSourceInPnpm(
              pj.name,
              typeof pj.version === "string" ? pj.version : undefined
            );
            if (srcDir) {
              const before = countFiles(full);
              mergeDir(srcDir, full);
              const after = countFiles(full);
              if (after > before) patchedFiles += after - before;
            }
          }
        } catch {
          /* package.json parse error */
        }
      }

      walkAndPatch(full);
    }
  };

  walkAndPatch(nextNm);

  if (patchedFiles > 0) {
    console.log(`  ✓ 兜底补齐 traced 包缺失文件：${patchedFiles} 个`);
  }
}

/**
 * 修复并验证 Next Turbopack traced 的关键 ESM 运行时文件。
 *
 * jsdom 的 html-encoding-sniffer 会动态 import
 * @exodus/bytes/fallback/single-byte.encodings.js；NFT 曾多次漏追踪这个文件。
 * 这个检查必须在 slimBundle 和最终 symlink 物化之后运行，避免构建阶段“补过”
 * 但最终交给 electron-builder 的目录里仍然缺失文件。
 */
function ensureCriticalTracedRuntimeFiles(): void {
  const nextNm = path.join(bundle, ".next", "node_modules");
  if (!fs.existsSync(nextNm)) return;

  const projectPnpm = path.join(root, "node_modules", ".pnpm");
  const requiredFiles = ["fallback/single-byte.js", "fallback/single-byte.encodings.js"];
  const findPackageDirs = (packageName: string): string[] => {
    const result: string[] = [];
    const visited = new Set<string>();

    const walk = (dir: string) => {
      try {
        const real = fs.realpathSync(dir);
        if (visited.has(real)) return;
        visited.add(real);
      } catch {
        return;
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        let isDirectory = entry.isDirectory();
        // Windows NFT 输出中的依赖经常是 junction；Dirent 不会把它标成目录。
        if (!isDirectory && entry.isSymbolicLink()) {
          try {
            isDirectory = fs.statSync(full).isDirectory();
          } catch {
            continue;
          }
        }
        if (!isDirectory) continue;
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(full, "package.json"), "utf8"));
          if (pkg.name === packageName) result.push(full);
        } catch {
          // 非包目录，继续向下查找深层 node_modules。
        }
        walk(full);
      }
    };
    walk(nextNm);
    return result;
  };

  const sourceFor = (packageName: string, version?: string): string => {
    const escapedName = packageName.replace("/", "+");
    const sourceEntry = fs.readdirSync(projectPnpm, { withFileTypes: true }).find(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith(version ? `${escapedName}@${version}` : `${escapedName}@`)
    );
    if (!sourceEntry) {
      throw new Error(`找不到 ${packageName}${version ? `@${version}` : ""} 的 pnpm 源目录`);
    }
    return path.join(projectPnpm, sourceEntry.name, "node_modules", packageName);
  };

  const packageVersionAt = (dir: string): string | undefined => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      return typeof pkg.version === "string" ? pkg.version : undefined;
    } catch {
      return undefined;
    }
  };

  const materializePackage = (source: string, destination: string) => {
    let redirected = !fs.existsSync(destination);
    if (!redirected) {
      try {
        const actual = fs.realpathSync(destination);
        const expected = path.resolve(destination);
        redirected = process.platform === "win32"
          ? actual.toLowerCase() !== expected.toLowerCase()
          : actual !== expected;
      } catch {
        redirected = true;
      }
    }
    // Windows junction 在 win-unpacked 中可读，但 NSIS 安装后会失效；用实体目录替换。
    if (redirected) {
      fs.rmSync(destination, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      safeCpSync(source, destination);
    }
  };

  const patchBytesDir = (tracedDir: string) => {
    const sourceDir = sourceFor("@exodus/bytes", packageVersionAt(tracedDir));
    materializePackage(sourceDir, tracedDir);
    for (const rel of requiredFiles) {
      const source = path.join(sourceDir, rel);
      const destination = path.join(tracedDir, rel);
      if (!fs.existsSync(source)) {
        throw new Error(`运行时依赖源文件缺失：${source}`);
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      // 强制覆盖，避免 NFT 产出的悬空链接或残缺文件逃过 existsSync 判断。
      fs.copyFileSync(source, destination);
      if (!fs.existsSync(destination)) {
        throw new Error(`运行时依赖补齐失败：${destination}`);
      }
    }
  };

  // 补齐所有可遍历的 traced @exodus/bytes 包。
  const tracedBytesDirs = findPackageDirs("@exodus/bytes");
  for (const tracedDir of tracedBytesDirs) patchBytesDir(tracedDir);

  // 关键：即使 html-encoding-sniffer / @exodus 以 junction 形式嵌套在 jsdom 中，
  // 也按 Turbopack 的实际运行时解析路径强制补齐，而不依赖通用遍历是否命中。
  const tracedJsdomDirs = findPackageDirs("jsdom");
  for (const jsdomDir of tracedJsdomDirs) {
    const htmlDir = path.join(jsdomDir, "node_modules", "html-encoding-sniffer");
    materializePackage(
      sourceFor("html-encoding-sniffer", packageVersionAt(htmlDir)),
      htmlDir
    );
    const bytesDir = path.join(
      jsdomDir,
      "node_modules",
      "html-encoding-sniffer",
      "node_modules",
      "@exodus",
      "bytes"
    );
    patchBytesDir(bytesDir);
  }

  if (tracedBytesDirs.length > 0 || tracedJsdomDirs.length > 0) {
    console.log(
      `  ✓ 验证并补齐 ${tracedBytesDirs.length} 个 traced @exodus/bytes、${tracedJsdomDirs.length} 个 jsdom 嵌套 ESM 依赖`
    );
  }
}

/**
 * 把 src 目录的内容合并到 dest（只补 dest 缺失的文件，不覆盖已有的）。
 *
 * 注意：fs.existsSync(dest) 会跟随符号链接——对悬空符号链接（target 不存在）返回 false，
 * 但路径实际被 symlink 目录项占用。Next.js NFT 追踪有时只创建 symlink 不复制实际包内容
 * （如 mime-db），导致 bundle 里残留指向 standalone 已清理路径的悬空 symlink。
 * 此处用 lstatSync 兜底：existsSync 返回 false 但 lstatSync 成功 → 悬空 symlink，先删后复制。
 */
function mergeDir(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    // 兜底：清理悬空符号链接（existsSync 返回 false 但路径被 symlink 占用）
    try {
      fs.lstatSync(dest);
      fs.rmSync(dest, { recursive: true, force: true });
    } catch {
      /* 路径确实为空，正常走 cpSync */
    }
    safeCpSync(src, dest);
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
    // 用 statSync 跟随符号链接判断类型：pnpm 的 node_modules 中子包目录常以 symlink 形式存在，
    // Dirent.isDirectory() 对 symlink 返回 false，会导致整个子目录树被跳过（如 @swc/helpers/_/）。
    let stat: fs.Stats;
    try {
      stat = fs.statSync(s);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      mergeDir(s, d);
    } else if (stat.isFile() && !fs.existsSync(d)) {
      // 同样清理可能存在的悬空 symlink（文件级）
      try {
        fs.lstatSync(d);
        fs.rmSync(d, { force: true });
      } catch {
        /* 无残留项 */
      }
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
/**
 * 把 Next standalone 根目录收敛到标准运行时入口。
 *
 * NFT 对动态 fs 路径会做保守追踪，黑名单永远追不上本地新增目录；实测会误带
 * `.env`、dev.database、graphify-out、inkpress-service（含本地 pem）和历史安装包。
 * 因此这里只保留 Next standalone 的标准四项，其余业务资源随后从仓库固定路径重建。
 */
function pruneUnexpectedBundleRoots(): void {
  const allowed = new Set([".next", "node_modules", "server.js", "package.json"]);
  let totalRemoved = 0;
  let cleaned = 0;
  for (const entry of fs.readdirSync(bundle, { withFileTypes: true })) {
    if (allowed.has(entry.name)) continue;
    const p = path.join(bundle, entry.name);
    const size = measureSize(p);
    fs.rmSync(p, { recursive: true, force: true });
    totalRemoved += size;
    cleaned++;
    console.log(`    ✓ 清理非运行时根项 ${entry.name}（约 ${(size / 1024 / 1024).toFixed(1)} MB）`);
  }
  if (cleaned > 0) {
    console.log(
      `  ✓ allowlist 清理 ${cleaned} 个误追踪根项（共约 ${(totalRemoved / 1024 / 1024).toFixed(1)} MB）`
    );
  }
}

/** 测量文件或目录的总大小（字节） */
function measureSize(target: string): number {
  let total = 0;
  const walk = (p: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  };
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) walk(target);
    else total = stat.size;
  } catch {
    /* ignore */
  }
  return total;
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

  const normalizeRel = (filePath: string) =>
    path.relative(bundle, filePath).split(path.sep).join("/");

  const removableRuntimeDirs = new Set([
    "test",
    "tests",
    "__tests__",
    "__mocks__",
    "example",
    "examples",
    "benchmark",
    "benchmarks",
    "coverage",
    ".github",
  ]);

  const shouldRemoveDirectory = (dirPath: string): boolean => {
    const rel = normalizeRel(dirPath);
    const insideNodeModules = rel.startsWith("node_modules/") || rel.includes("/node_modules/");
    return insideNodeModules && removableRuntimeDirs.has(path.basename(dirPath));
  };

  const shouldRemove = (filePath: string): boolean => {
    const base = path.basename(filePath);
    // Windows path.relative 使用反斜杠；统一为 POSIX 分隔符后再套用规则。
    const rel = normalizeRel(filePath);
    const insideNodeModules = rel.startsWith("node_modules/") || rel.includes("/node_modules/");

    // Next output file tracing 清单仅供构建/部署工具使用，standalone 运行时不读取；
    // 其中还包含构建机绝对路径，发布前删除可稳定减少十余 MB 并避免路径泄漏。
    if (rel.startsWith(".next/") && base.endsWith(".nft.json")) return true;

    // 下面的源码/文档裁剪只能作用于第三方依赖，严禁误删 public、系统 Skill、主题或迁移。
    if (!insideNodeModules) return base === ".DS_Store";

    // 1. better-sqlite3 的编译期产物（sqlite 源码 + C++ 源码）
    if (rel.includes("better-sqlite3")) {
      if (rel.includes("/deps/") || rel.includes("/src/")) return true;
    }

    // 2. 按扩展名/文件名剔除
    if (base.endsWith(".d.ts")) return true;
    if (base.endsWith(".d.mts")) return true;
    if (base.endsWith(".d.cts")) return true;
    if (base.endsWith(".ts") && !base.endsWith(".d.ts")) return true;
    if (base.endsWith(".tsx") || base.endsWith(".mts") || base.endsWith(".cts")) return true;
    if (base.endsWith(".map")) return true;
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
        if (shouldRemoveDirectory(full)) {
          removedFiles += countFiles(full);
          removedBytes += measureSize(full);
          fs.rmSync(full, { recursive: true, force: true });
          continue;
        }
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

/* ============ esbuild bundle：把 node_modules 压成单个 server.bundle.js ============ */

/**
 * 用 esbuild bundle Next.js standalone server.js。
 *
 * 把 925 MB node_modules 压成单个 server.bundle.js（~30 MB），
 * 只保留 externals（原生模块 + 其依赖闭包）在 node_modules 里运行时加载。
 *
 * 关键技术点：
 * 1. 自定义 plugin 处理 require.resolve（Next 内部用，esbuild 无法 bundle）
 * 2. 自定义 plugin fallback：解析失败的 import 标记为 external（Next 的条件依赖如 critters）
 * 3. external 包内发出的 require 也 external（保留其依赖链在 node_modules）
 * 4. .map 文件用 empty loader（source map 生产不需要）
 *
 * PoC 验证：bundle 后首页 200、/api/themes 返回正常 JSON、Prisma 正常查询。
 */
async function bundleServerJs(): Promise<void> {
  const { build } = await import("esbuild");
  const serverJs = path.join(bundle, "server.js");
  const outFile = path.join(bundle, "server.bundle.js");

  if (!fs.existsSync(serverJs)) {
    console.warn("  ⚠ server.js 不存在，跳过 esbuild bundle");
    return;
  }

  const externalClosure = collectExternalClosure();
  const nmDir = path.join(bundle, "node_modules") + path.sep;
  const isInsideExternal = (filePath: string): boolean => {
    if (!filePath.startsWith(nmDir)) return false;
    const rel = path.relative(nmDir, filePath);
    const parts = rel.split(path.sep);
    const pkgName = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
    return externalClosure.has(pkgName);
  };

  const builtinSet = new Set([
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ]);

  const resolvePlugin = {
    name: "inkpress-resolve",
    setup(buildInst: any) {
      // esbuild 会为某些动态 require 通配模式直接枚举同目录文件，绕过 onResolve；
      // 完整补包后 LICENSE/README 也可能被当作模块载入。它们属于构建期文档且稍后会
      // 从 node_modules 裁剪，使用 empty loader 可避免被误解析成 JavaScript。
      buildInst.onLoad(
        {
          filter:
            /[\\/](LICENSE|LICENCE|NOTICE|README|CHANGELOG|CHANGES|CONTRIBUTING|SECURITY)(\.[^\\/]*)?$/i,
        },
        () => ({ contents: "", loader: "empty" })
      );
      buildInst.onResolve({ filter: /.*/ }, (args: any) => {
        // 1. require.resolve → external（Next 内部用，运行时从 node_modules 解析）
        if (args.kind === "require-resolve") {
          return { path: args.path, external: true };
        }
        if (args.kind === "entry-point") return undefined;
        // 2. .map 文件 → external
        if (args.path.endsWith(".map")) {
          return { path: args.path, external: true };
        }
        // 3. Node 内置模块 → external
        if (builtinSet.has(args.path) || builtinSet.has(args.path.replace(/^node:/, ""))) {
          return { path: args.path, external: true };
        }
        // 4. externals 闭包（bare specifier）→ external
        for (const ext of externalClosure) {
          if (args.path === ext || args.path.startsWith(ext + "/")) {
            return { path: args.path, external: true };
          }
        }
        // 5. 从 external 包内部发出的 require → external（保留依赖链）
        if (args.importer && isInsideExternal(args.importer)) {
          return { path: args.path, external: true };
        }
        // 6. 其他 → 尝试 Node 解析，失败则 external（条件依赖：critters、dev 工具等）
        try {
          const importerDir = args.importer ? path.dirname(args.importer) : bundle;
          const importerRequire = createRequire(path.join(importerDir, "__anchor__.js"));
          const resolved = importerRequire.resolve(args.path);
          // require.resolve 也能命中 LICENSE、WASM、原生 .node 等非 JS 资源。
          // 这些文件必须保留在完整包中，但绝不能交给 esbuild 当 JavaScript 解析。
          // JSON 可由 esbuild 安全内联，其余非脚本资源沿用 Node 的运行时加载语义。
          const resolvedExt = path.extname(resolved).toLowerCase();
          if (![".js", ".cjs", ".mjs", ".json"].includes(resolvedExt)) {
            return { path: resolved, external: true };
          }
          return { path: resolved };
        } catch {
          return { path: args.path, external: true };
        }
      });
    },
  };

  console.log("  → esbuild bundle server.js…");
  const startMs = Date.now();
  const result = await build({
    entryPoints: [serverJs],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: outFile,
    plugins: [resolvePlugin],
    loader: { ".map": "empty" },
    metafile: true,
    allowOverwrite: true,
    legalComments: "none",
    logLevel: "silent",
    logOverride: {
      "dynamic-require": "silent",
      "import-is-undefined": "silent",
    },
  });

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
  const inputCount = Object.keys(result.metafile.inputs).length;
  console.log(`    ✓ server.bundle.js（${sizeMB} MB，${inputCount} inputs，${elapsed}s）`);

  // 删除原 server.js，用 server.bundle.js 替代
  fs.rmSync(serverJs);
  fs.renameSync(outFile, serverJs);
  console.log(`    ✓ server.bundle.js → server.js（替换原入口）`);
}

/**
 * 收集 externals 的完整依赖闭包。
 *
 * externals 包（better-sqlite3、@prisma/client 等）被 esbuild external 后，
 * 它们的 dependencies 也要留在 node_modules（运行时 require）。
 *
 * 同时包含 Next Turbopack runtime 用 externalRequire 加载的 nft 追踪包
 * （.next/node_modules/ 里的包，如 pino-HASH、postcss-HASH 等）。
 * 这些包的 package.json name 是真实名（不带 HASH），依赖也必须保留。
 *
 * BFS 遍历每个 external 的 package.json dependencies。
 *
 * @param includeNext 是否把 next 整包加入闭包。
 *   - false（默认，esbuild bundle 用）：next 被 esbuild 内联到 server.bundle.js，
 *     不作为 external。
 *   - true（pruneBundledNodeModules 用）：next 整包保留在 node_modules。
 *     原因：Next 16 Turbopack 的 runtime chunk
 *     .next/server/chunks/ssr/[turbopack]_runtime.js 渲染时会
 *     externalRequire('next/dist/compiled/next-server/app-page-turbo.runtime.prod.js')
 *     等子模块，这条 require 不在 server.js 静态依赖图里、esbuild bundle 不到，
 *     必须运行时从 node_modules/next/ 解析。若 prune 删了 next，渲染必崩（500）。
 */
function collectExternalClosure(opts?: { includeNext?: boolean }): Set<string> {
  const seed = opts?.includeNext ? [...SERVER_EXTERNALS, "next"] : SERVER_EXTERNALS;
  const closure = new Set<string>(seed);
  const queue = [...seed];
  const nmDir = path.join(bundle, "node_modules");

  // 若包含 next：把 next 的 peerDependencies 也加入闭包种子。
  // 原因：next 内部 require('react')、require('react-dom')，
  // 但 react/react-dom 是 next 的 peerDependencies 而非 dependencies，
  // 下面的 BFS 只读 dependencies / optionalDependencies，到不了 react。
  // 排除 @playwright/test（dev/test 工具，运行时不需要，体积 ~100MB）。
  if (opts?.includeNext) {
    try {
      const bundleRequire = createRequire(path.join(bundle, "__closure_anchor__.js"));
      const nextPjPath = bundleRequire.resolve("next/package.json");
      const nextPj = JSON.parse(fs.readFileSync(nextPjPath, "utf8"));
      for (const peer of Object.keys(nextPj.peerDependencies || {})) {
        if (peer === "@playwright/test") continue;
        if (!closure.has(peer)) {
          closure.add(peer);
          queue.push(peer);
        }
      }
    } catch {
      /* next package.json 暂不可用（bundleServerJs 阶段），忽略 */
    }
  }

  // 额外收集 .next/node_modules/ 里的 nft 追踪包
  // Turbopack runtime 用 externalRequire('pkgName-HASH') 加载这些包
  // 同时读取它们的 dependencies（这些包可能不在顶层，readPkgDeps 找不到）
  const nextNmDir = path.join(bundle, ".next", "node_modules");
  if (fs.existsSync(nextNmDir)) {
    const collectFromDir = (dir: string, scope = "") => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const pkgDir = path.join(dir, e.name);
        const pjPath = path.join(pkgDir, "package.json");
        if (!fs.existsSync(pjPath)) {
          if (e.name.startsWith("@") && !scope) {
            collectFromDir(pkgDir, e.name + "/");
          }
          continue;
        }
        try {
          const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
          if (pj.name && !closure.has(pj.name)) {
            closure.add(pj.name);
            queue.push(pj.name);
          }
          // 直接从这个 package.json 收集 dependencies
          for (const dep of [
            ...Object.keys(pj.dependencies || {}),
            ...Object.keys(pj.optionalDependencies || {}),
          ]) {
            if (!closure.has(dep)) {
              closure.add(dep);
              queue.push(dep);
            }
          }
        } catch {
          /* ignore */
        }
      }
    };
    collectFromDir(nextNmDir);
  }

  const readPkgDeps = (pkgName: string): string[] => {
    // Next 的 optionalDependencies 是构建期 SWC（~119 MB）和图片优化 Sharp（~16 MB）。
    // 本项目运行预编译 standalone，且 next/image 已设置 unoptimized，不需要在目标机编译/转图。
    // 只跳过 Next 自身的 optional 依赖；其他 external（Claude/Resvg）的平台包必须保留。
    const depsFromPackageJson = (pj: Record<string, any>): string[] => [
      ...Object.keys(pj.dependencies || {}),
      ...(pkgName === "next" ? [] : Object.keys(pj.optionalDependencies || {})),
    ];
    // 优先用 Node 的模块解析（能穿透 pnpm 的 .pnpm 深层结构）
    try {
      const bundleRequire = createRequire(path.join(bundle, "__closure_anchor__.js"));
      const resolved = bundleRequire.resolve(`${pkgName}/package.json`);
      const pj = JSON.parse(fs.readFileSync(resolved, "utf8"));
      return depsFromPackageJson(pj);
    } catch {
      /* fallthrough */
    }
    // 回退：直接路径查找（顶层 / 虚拟根）
    const paths = [
      path.join(nmDir, pkgName, "package.json"),
      path.join(nmDir, ".pnpm", "node_modules", pkgName, "package.json"),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        try {
          const pj = JSON.parse(fs.readFileSync(p, "utf8"));
          return depsFromPackageJson(pj);
        } catch {
          /* ignore */
        }
      }
    }
    return [];
  };

  while (queue.length > 0) {
    const pkg = queue.shift()!;
    for (const dep of readPkgDeps(pkg)) {
      if (!closure.has(dep)) {
        closure.add(dep);
        queue.push(dep);
      }
    }
  }
  return closure;
}

/**
 * 删除 bundle 已内联的 node_modules。
 *
 * bundle 后，只有 externals 闭包需要留在 node_modules（运行时 require）。
 * 其他包都被内联到 server.bundle.js 里，可以删除。
 *
 * 同时清理：
 * - .next/node_modules（nft 追踪包，bundle 已内联）
 * - .pnpm 虚拟存储（externals 已提升到顶层）
 * - .bin（npm 脚本）
 */
function pruneBundledNodeModules(): void {
  // includeNext: true → next 整包保留在 node_modules，供 Turbopack chunks
  // 运行时 externalRequire('next/dist/compiled/...') 解析（详见函数注释）
  const closure = collectExternalClosure({ includeNext: true });
  const nmDir = path.join(bundle, "node_modules");
  const pnpmDir = path.join(nmDir, ".pnpm");

  let removedBytes = 0;
  let removedPkgs = 0;

  const sizeOf = (p: string): number => {
    const walk = (d: string): number => {
      let total = 0;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return 0;
      }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) total += walk(full);
        else if (e.isFile()) {
          try {
            total += fs.statSync(full).size;
          } catch {
            /* ignore */
          }
        }
      }
      return total;
    };
    try {
      return walk(p);
    } catch {
      return 0;
    }
  };

  // 1. 把闭包内的包从完整项目虚拟根按需 merge 到顶层。
  // NFT 可能已创建“存在但残缺”的目录，不能仅用 existsSync 判断后跳过。
  const virtualRoot = path.join(pnpmDir, "node_modules");
  const projectVirtualRoot = path.join(root, "node_modules", ".pnpm", "node_modules");
  for (const pkg of closure) {
    const topLevel = path.join(nmDir, pkg);
    const projectTopLevel = path.join(root, "node_modules", pkg);
    const projectPkg = path.join(projectVirtualRoot, pkg);
    const bundlePkg = path.join(virtualRoot, pkg);
    const source = fs.existsSync(projectTopLevel)
      ? projectTopLevel
      : fs.existsSync(projectPkg)
        ? projectPkg
        : bundlePkg;
    if (fs.existsSync(source)) {
      fs.mkdirSync(path.dirname(topLevel), { recursive: true });
      mergeDir(source, topLevel);
    }
  }

  // 2. 删除顶层非闭包的包
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(nmDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.name.startsWith("@")) {
      const scopeDir = path.join(nmDir, e.name);
      let subs: fs.Dirent[];
      try {
        subs = fs.readdirSync(scopeDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sub of subs) {
        const fullName = `${e.name}/${sub.name}`;
        if (!closure.has(fullName)) {
          const p = path.join(scopeDir, sub.name);
          removedBytes += sizeOf(p);
          fs.rmSync(p, { recursive: true, force: true });
          removedPkgs++;
        }
      }
      try {
        if (fs.readdirSync(scopeDir).length === 0) fs.rmdirSync(scopeDir);
      } catch {
        /* ignore */
      }
    } else if (!closure.has(e.name)) {
      const p = path.join(nmDir, e.name);
      removedBytes += sizeOf(p);
      fs.rmSync(p, { recursive: true, force: true });
      removedPkgs++;
    }
  }

  // 3. 删除 .pnpm（externals 已提升到顶层）
  if (fs.existsSync(pnpmDir)) {
    removedBytes += sizeOf(pnpmDir);
    fs.rmSync(pnpmDir, { recursive: true, force: true });
  }

  // 4. 删除 .bin
  const binDir = path.join(nmDir, ".bin");
  if (fs.existsSync(binDir)) {
    removedBytes += sizeOf(binDir);
    fs.rmSync(binDir, { recursive: true, force: true });
  }

  // 注：不删除 .next/node_modules/ —— Next Turbopack runtime 用
  // externalRequire('pino-HASH') 加载带哈希的包（nft 追踪包），这些包必须保留

  console.log(
    `    ✓ 删除 ${removedPkgs} 个非 externals 包 + .pnpm（约 ${(removedBytes / 1024 / 1024).toFixed(1)} MB）`
  );
  console.log(`    ✓ externals 闭包保留：${closure.size} 个包`);
}

type PlatformRuntimeSpec = {
  packageName: string;
  binary: string;
  executable?: boolean;
};

/** 当前目标平台必须随包携带的原生运行时。 */
function platformRuntimeSpecs(): PlatformRuntimeSpec[] {
  if (process.platform === "darwin") {
    return [
      {
        packageName: `@anthropic-ai/claude-agent-sdk-darwin-${targetArch}`,
        binary: "claude",
        executable: true,
      },
      {
        packageName: `@resvg/resvg-js-darwin-${targetArch}`,
        binary: `resvgjs.darwin-${targetArch}.node`,
      },
    ];
  }
  if (process.platform === "win32" && targetArch === "x64") {
    return [
      {
        packageName: "@anthropic-ai/claude-agent-sdk-win32-x64",
        binary: "claude.exe",
        executable: true,
      },
      {
        packageName: "@resvg/resvg-js-win32-x64-msvc",
        binary: "resvgjs.win32-x64-msvc.node",
      },
    ];
  }
  console.error(`  ✗ 尚未定义 ${process.platform}-${targetArch} 的原生运行时清单`);
  process.exit(1);
}

/**
 * pnpm/Next tracing 对「无 main/exports 的 optional native package」解析不稳定。
 * 从根项目显式 optionalDependency 复制到 bundle 顶层，SDK 的 createRequire 可稳定向上解析。
 */
function ensurePlatformRuntimePackages(): void {
  for (const spec of platformRuntimeSpecs()) {
    const src = path.join(root, "node_modules", spec.packageName);
    const srcBinary = path.join(src, spec.binary);
    if (!fs.existsSync(srcBinary)) {
      console.error(
        `  ✗ 缺少 ${spec.packageName}/${spec.binary}。` +
          " 请重新执行 pnpm install --frozen-lockfile，且不要使用 --no-optional/--omit=optional。"
      );
      process.exit(1);
    }
    const dest = path.join(bundle, "node_modules", spec.packageName);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    safeCpSync(src, dest);
    const destBinary = path.join(dest, spec.binary);
    if (spec.executable && process.platform !== "win32") fs.chmodSync(destBinary, 0o755);
    if (process.platform === "darwin") verifyNodeArch(destBinary, targetArch);
    else verifyPeArch(destBinary, targetArch);
    console.log(`  ✓ 原生运行时 ${spec.packageName} → node_modules/${spec.packageName}`);
  }
}

/** 最终 bundle 完整性门禁；任何缺失都直接中止打包。 */
function verifyPreparedBundle(): void {
  const required = [
    "server.js",
    "server.jsc",
    "server.jsc.sha256",
    ".next/BUILD_ID",
    ".next/required-server-files.json",
    ".next/static",
    "public",
    "resources/skills/system",
    "themes",
    "migrations",
    "node_modules/next/package.json",
    "node_modules/better-sqlite3/package.json",
    "node_modules/bytenode/lib/index.js",
  ];
  for (const rel of required) {
    if (!fs.existsSync(path.join(bundle, rel))) {
      console.error(`  ✗ bundle 完整性失败：缺少 ${rel}`);
      process.exit(1);
    }
  }

  for (const [source, destination, label] of [
    [path.join(root, ".next", "static"), path.join(bundle, ".next", "static"), ".next/static"],
    [path.join(root, "public"), path.join(bundle, "public"), "public"],
    [path.join(root, "themes"), path.join(bundle, "themes"), "themes"],
    [
      path.join(root, "resources", "skills", "system"),
      path.join(bundle, "resources", "skills", "system"),
      "resources/skills/system",
    ],
    [path.join(root, "prisma", "migrations"), path.join(bundle, "migrations"), "migrations"],
  ] as const) {
    verifyMirroredTree(source, destination, label);
  }
  const skillFiles = findAllFiles(path.join(bundle, "resources", "skills", "system"), "SKILL.md");
  if (skillFiles.length === 0) {
    console.error("  ✗ bundle 系统 Skill 内容为空（缺少 SKILL.md）");
    process.exit(1);
  }

  const expectedHash = fs.readFileSync(path.join(bundle, "server.jsc.sha256"), "utf8").trim();
  const actualHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(bundle, "server.jsc")))
    .digest("hex");
  if (expectedHash !== actualHash) {
    console.error("  ✗ server.jsc SHA-256 不匹配");
    process.exit(1);
  }

  const metadataText = fs.readFileSync(
    path.join(bundle, ".next", "required-server-files.json"),
    "utf8"
  );
  const metadataValue = JSON.parse(metadataText);
  if (valueContainsBuildRoot(metadataValue)) {
    console.error("  ✗ bundle 运行时元数据泄漏构建机绝对路径");
    process.exit(1);
  }

  const allowedRoots = new Set([
    ".next",
    "node_modules",
    "server.js",
    "server.jsc",
    "server.jsc.sha256",
    "package.json",
    "public",
    "resources",
    "themes",
    "migrations",
  ]);
  const unexpected = fs.readdirSync(bundle).filter((name) => !allowedRoots.has(name));
  if (unexpected.length > 0) {
    console.error(`  ✗ bundle 含未授权根项：${unexpected.join(", ")}`);
    process.exit(1);
  }

  const symlinks: string[] = [];
  const scanLinks = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) symlinks.push(path.relative(bundle, full));
      else if (entry.isDirectory()) scanLinks(full);
    }
  };
  scanLinks(bundle);
  if (symlinks.length > 0) {
    console.error(`  ✗ bundle 仍含 ${symlinks.length} 个符号链接：${symlinks.slice(0, 5).join(", ")}`);
    process.exit(1);
  }

  // SWC 与 Sharp 仅用于构建/图片优化，打进应用会额外增加约 135 MB。
  const forbiddenBuildPackages = [
    path.join(bundle, "node_modules", "sharp"),
    path.join(bundle, "node_modules", "@next", `swc-${process.platform}-${targetArch}`),
  ];
  for (const p of forbiddenBuildPackages) {
    if (fs.existsSync(p)) {
      console.error(`  ✗ 构建期包未被裁剪：${path.relative(bundle, p)}`);
      process.exit(1);
    }
  }

  const nativeBindings = findAllFiles(bundle, "better_sqlite3.node");
  if (nativeBindings.length === 0) {
    console.error("  ✗ bundle 缺少 better_sqlite3.node");
    process.exit(1);
  }
  for (const binding of nativeBindings) {
    if (process.platform === "darwin") verifyNodeArch(binding, targetArch);
    else verifyPeArch(binding, targetArch);
  }
  for (const spec of platformRuntimeSpecs()) {
    const binary = path.join(bundle, "node_modules", spec.packageName, spec.binary);
    if (!fs.existsSync(binary)) {
      console.error(`  ✗ bundle 缺少平台运行时 ${spec.packageName}/${spec.binary}`);
      process.exit(1);
    }
  }

  verifyReactServerExports();

  const bytes = measureSize(bundle);
  const files = countFiles(bundle);
  console.log(
    `  ✓ bundle 完整性通过：${files} files，${(bytes / 1024 / 1024).toFixed(1)} MB，arch=${targetArch}`
  );
}

/** 用目标 Electron/V8 的 react-server 条件实际解析 React，防止 NFT 残片漏掉 exports 目标。 */
function verifyReactServerExports(): void {
  const electronBin = resolveElectronBinary();
  const anchor = path.join(bundle, "__runtime_contract__.cjs");
  const code = `
const { createRequire } = require("node:module");
const req = createRequire(${JSON.stringify(anchor)});
const react = req("react");
const reactDom = req("react-dom");
if (typeof react.createElement !== "function" || !reactDom) process.exit(2);
console.log("[react-server-contract] PASS");
`;
  const result = spawnSync(electronBin, ["--conditions=react-server", "-e", code], {
    cwd: bundle,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0 || !output.includes("[react-server-contract] PASS")) {
    console.error(`  ✗ React react-server 条件导出不完整：\n${output.slice(-4000)}`);
    process.exit(1);
  }
}

/** 对受控资源目录做文件名 + 内容哈希全量比对，防止瘦身规则误删业务资源。 */
function verifyMirroredTree(source: string, destination: string, label: string): void {
  const manifest = (base: string): Map<string, string> => {
    const result = new Map<string, string>();
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) visit(full);
        else if (stat.isFile()) {
          const rel = path.relative(base, full).split(path.sep).join("/");
          const hash = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
          result.set(rel, hash);
        }
      }
    };
    visit(base);
    return result;
  };

  const expected = manifest(source);
  const actual = manifest(destination);
  if (expected.size !== actual.size) {
    console.error(`  ✗ ${label} 镜像文件数不一致：源=${expected.size}，bundle=${actual.size}`);
    process.exit(1);
  }
  for (const [file, hash] of expected) {
    if (actual.get(file) !== hash) {
      console.error(`  ✗ ${label} 镜像缺失或内容不一致：${file}`);
      process.exit(1);
    }
  }
}

/* ============ Bytecode 保护：server.js → server.jsc + 薄加载器 ============ */

/**
 * 解析 Electron 二进制绝对路径。
 *
 * `require('electron')` 执行 electron 包的 index.js，返回当前平台 Electron 可执行文件
 * 的绝对路径（如 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron）。
 * 回退到 node_modules/.bin/electron（cli.js 包装器）。
 *
 * 必须用 Electron 二进制（而非系统 Node）编译 bytecode：V8 字节码绑定 V8 版本，
 * Electron 42 内嵌 V8 14.8.x，系统 Node 22 是 V8 12.4.x，跨版本加载 .jsc 会
 * ERR_INVALID_BYTECODE。
 */
function resolveElectronBinary(): string {
  try {
    const projectRequire = createRequire(path.join(root, "package.json"));
    const resolved = projectRequire("electron");
    if (typeof resolved === "string" && fs.existsSync(resolved)) {
      return resolved;
    }
  } catch {
    /* fallthrough */
  }
  const fallback = path.join(root, "node_modules", ".bin", "electron");
  if (fs.existsSync(fallback)) return fallback;
  console.error(
    "  ✗ 无法解析 Electron 二进制路径（require('electron') 失败，且 node_modules/.bin/electron 不存在）"
  );
  process.exit(1);
}

/**
 * 把项目 node_modules/bytenode 复制到 bundle/node_modules/bytenode。
 *
 * bytecode 运行时的薄加载器 server.js 执行 require('bytenode') 注册 .jsc handler，
 * 该 require 从 server.js 同级 node_modules 解析。pruneBundledNodeModules 已删除
 * 非闭包包，bytenode 不在 externals 闭包内（仅构建期使用），因此必须显式复制。
 *
 * bytenode 是纯 JS 包（~5 KB 单文件，无 native 绑定，无 dependencies），直接
 * cpSync 即可，无需依赖闭包处理。必须在 pruneBundledNodeModules / slimBundle 之后
 * 执行，避免被清除。
 */
function ensureBytenodeInBundle(): void {
  const src = path.join(root, "node_modules", "bytenode");
  const dest = path.join(bundle, "node_modules", "bytenode");
  if (!fs.existsSync(src)) {
    console.error("  ✗ 项目 node_modules/bytenode 不存在，请先 pnpm add -D bytenode");
    process.exit(1);
  }
  safeCpSync(src, dest);
  const sizeKB = (measureSize(dest) / 1024).toFixed(1);
  console.log(`  ✓ bytenode → node_modules/bytenode（${sizeKB} KB）`);
}

/**
 * 用 Electron + bytenode 把 bundle/server.js 编译为 server.jsc，并覆写为薄加载器。
 *
 * 流程：
 * 1. spawn(Electron, [compile-bytecode.cjs, server.js], { ELECTRON_RUN_AS_NODE: "1" })
 * 2. 编译脚本内部：bytenode.compileFile → 写 server.jsc + server.jsc.sha256 + 薄加载器
 * 3. 验证 server.jsc 产物存在
 *
 * 失败策略：直接终止构建。安装包完整性门禁始终要求 bytecode + SHA-256，
 * 不允许悄悄回退为与正式产物结构不同的明文入口。
 */
function compileBytecode(): void {
  const compileScript = path.join(root, "scripts", "compile-bytecode.cjs");
  const serverJs = path.join(bundle, "server.js");
  const jscPath = path.join(bundle, "server.jsc");

  if (!fs.existsSync(compileScript)) {
    console.error(`  ✗ bytecode 编译脚本不存在: ${compileScript}`);
    process.exit(1);
  }
  if (!fs.existsSync(serverJs)) {
    console.error("  ✗ server.js 不存在，无法编译 bytecode");
    process.exit(1);
  }

  const electronBin = resolveElectronBinary();
  console.log(`  → 用 Electron 编译 bytecode（V8 版本一致性保证）…`);

  const result = spawnSync(electronBin, [compileScript, serverJs], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0 || !fs.existsSync(jscPath)) {
    console.error(`  ✗ bytecode 编译失败（退出码 ${result.status}）`);
    process.exit(1);
  }

  console.log(`  ✓ bytecode 保护已启用：server.jsc + 薄加载器`);
}
