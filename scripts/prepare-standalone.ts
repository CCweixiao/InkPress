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
 *
 * 目标 CPU 架构（better-sqlite3 原生绑定必须与 electron-builder --arch 一致）：
 * - 环境变量 INKPRESS_TARGET_ARCH=arm64|x64（electron-build.mjs 注入）
 * - CLI 参数 --arm64 | --x64
 * - 默认：process.arch
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire, builtinModules } from "node:module";

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
const SERVER_EXTERNALS = [
  "better-sqlite3",
  "@prisma/adapter-better-sqlite3",
  "@prisma/client",
  "adm-zip",
  "ali-oss",
];

if (!fs.existsSync(srcStandalone)) {
  console.error("✗ .next/standalone 不存在，请先执行 pnpm build（需 output: standalone）");
  process.exit(1);
}

// 清理旧 bundle，重建
fs.rmSync(bundle, { recursive: true, force: true });

console.log(`生成去符号链接的 standalone bundle（目标架构 ${targetArch}）…`);
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

// 提升 .pnpm/node_modules/ 虚拟根内容到顶层 node_modules/，确保 require 解析可达。
// pnpm 的依赖解析依赖符号链接：顶层 next/ 是指向 .pnpm/next@*/node_modules/next/ 的
// symlink，其依赖 @swc/helpers 在虚拟存储的兄弟目录下。materializeSymlinks 把 symlink
// 物化为真实目录后，顶层 next/ 变成独立目录，兄弟解析路径断裂，导致 require('@swc/helpers')
// 找不到模块。这里从项目 .pnpm/node_modules/ 补全 bundle 的虚拟根，再把缺失的包提升到顶层。
hoistMissingTopLevel();

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

// 6-8. esbuild bundle + prune + slimBundle（esbuild build 异步，用 IIFE 包装）
void (async () => {
  // 6. esbuild bundle：把 925 MB node_modules 压成单个 server.bundle.js
  await bundleServerJs();
  // 7. 删除 bundle 已内联的 node_modules（保留 externals 及其依赖闭包）
  pruneBundledNodeModules();
  // 8. 瘦身：剔除 externals 残留的 .d.ts / .map / .md 等
  slimBundle();
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
 * 注意：必须在 bundle 的 app_modules 上跑（而非项目 node_modules），
 * 因为 standalone 用 NODE_PATH 指向 app_modules 解析依赖。
 */
function ensureNativeBindingForElectron() {
  console.log(`  → 为 Electron 重编译 better-sqlite3 原生绑定（arch=${targetArch}）…`);

  // 在项目根目录用 @electron/rebuild 重编译（需要标准 node_modules 结构）
  const electronVersion = JSON.parse(
    fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8")
  ).version;

  const rebuildBin = path.join(root, "node_modules", ".bin", "electron-rebuild");
  const result = spawnSync(
    rebuildBin,
    [
      "-f",
      "-w",
      "better-sqlite3",
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

  // 把重编译后的 .node 复制到 bundle 的所有 better-sqlite3 副本
  const src = findNativeBindingForArch(
    path.join(root, "node_modules"),
    targetArch
  );
  if (!src) {
    console.error(
      `  ✗ 项目 node_modules 找不到 arch=${targetArch} 的 better_sqlite3.node`
    );
    process.exit(1);
  }

  verifyNodeArch(src, targetArch);

  // 扫描整个 bundle 刷新所有 better_sqlite3.node 副本：
  // - node_modules/{better-sqlite3,.pnpm/better-sqlite3@*}/...（常规路径）
  // - .next/node_modules/better-sqlite3-*/...（Next.js nft 追踪生成的带哈希副本，运行时优先命中）
  let refreshed = 0;
  const targets = findAllFiles(bundle, "better_sqlite3.node");
  for (const t of targets) {
    fs.copyFileSync(src, t);
    verifyNodeArch(t, targetArch);
    refreshed++;
  }
  console.log(
    `  ✓ better-sqlite3（Electron ABI，${targetArch}）已刷新 ${refreshed} 处`
  );
}

/** 在 node_modules 树中查找与目标架构匹配的 better_sqlite3.node */
function findNativeBindingForArch(
  nmRoot: string,
  arch: "arm64" | "x64"
): string | null {
  const candidates = findAllFiles(nmRoot, "better_sqlite3.node");
  const expected = machArchLabel(arch);
  for (const candidate of candidates) {
    const r = spawnSync("lipo", ["-archs", candidate], { encoding: "utf8" });
    if (r.status !== 0) continue;
    const actual = (r.stdout ?? "").trim().split(/\s+/);
    if (actual.includes(expected)) return candidate;
  }
  return null;
}

/** 校验 .node 文件的 CPU 架构，不匹配则终止打包 */
function verifyNodeArch(nodePath: string, arch: "arm64" | "x64"): void {
  const expected = machArchLabel(arch);
  const r = spawnSync("lipo", ["-archs", nodePath], { encoding: "utf8" });
  if (r.status !== 0) {
    console.warn(`  ⚠ 无法验证 ${path.relative(root, nodePath)} 的 CPU 架构`);
    return;
  }
  const actual = (r.stdout ?? "").trim().split(/\s+/).filter(Boolean);
  if (!actual.includes(expected)) {
    console.error(
      `  ✗ ${path.relative(root, nodePath)} 架构不匹配：期望 ${expected}，实际 ${actual.join(", ") || "未知"}`
    );
    process.exit(1);
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

  // 1. 用项目虚拟根补全 bundle 虚拟根（nft 追踪常遗漏子路径 exports 如 @swc/helpers/_/）
  if (fs.existsSync(bundleVirtualRoot)) {
    mergeDir(projVirtualRoot, bundleVirtualRoot);
  }

  // 2. BFS：从顶层已有包出发，沿 dependencies 边遍历，仅提升缺失的运行时依赖
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
    // 包不存在于顶层 → 从虚拟根提升
    if (!fs.existsSync(pkgDir)) {
      const srcDep = path.join(bundleVirtualRoot, pkg);
      if (!fs.existsSync(srcDep)) continue;
      fs.cpSync(srcDep, pkgDir, { recursive: true, dereference: true });
      hoisted++;
    }
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
    // 优先用 Node 的模块解析（能穿透 pnpm 的 .pnpm 深层结构）
    try {
      const bundleRequire = createRequire(path.join(bundle, "__closure_anchor__.js"));
      const resolved = bundleRequire.resolve(`${pkgName}/package.json`);
      const pj = JSON.parse(fs.readFileSync(resolved, "utf8"));
      return [
        ...Object.keys(pj.dependencies || {}),
        ...Object.keys(pj.optionalDependencies || {}),
      ];
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
          return [
            ...Object.keys(pj.dependencies || {}),
            ...Object.keys(pj.optionalDependencies || {}),
          ];
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

  // 1. 把闭包内的包从 .pnpm 虚拟根提升到顶层（如果顶层没有）
  const virtualRoot = path.join(pnpmDir, "node_modules");
  if (fs.existsSync(virtualRoot)) {
    for (const pkg of closure) {
      const topLevel = path.join(nmDir, pkg);
      if (fs.existsSync(topLevel)) continue;
      const virtualPkg = path.join(virtualRoot, pkg);
      if (fs.existsSync(virtualPkg)) {
        fs.mkdirSync(path.dirname(topLevel), { recursive: true });
        fs.cpSync(virtualPkg, topLevel, { recursive: true, dereference: true });
      }
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
