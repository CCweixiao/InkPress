/**
 * 量化 standalone bundle 体积构成。
 *
 * 输出三个维度：
 * 1. 顶层目录体积分布（node_modules / .next / public / ...）
 * 2. 按删除规则分类的体积（test/tests/__tests__/docs/.cache/.d.ts 等）
 * 3. 包重复检测：相同 package@version 在多个位置出现的冗余
 *
 * 用法：pnpm tsx scripts/analyze-bundle-size.ts [bundle-path]
 * 默认：.next/standalone-bundle
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const bundle = path.resolve(process.argv[2] || path.join(process.cwd(), ".next", "standalone-bundle"));

if (!fs.existsSync(bundle)) {
  console.error(`✗ bundle 不存在：${bundle}`);
  process.exit(1);
}

type FileInfo = { path: string; size: number };

console.log(`\n=== 扫描 ${path.relative(process.cwd(), bundle)} ===\n`);

// ========== 第一阶段：全量收集文件列表 ==========
const allFiles: FileInfo[] = [];
{
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try {
          allFiles.push({ path: full, size: fs.statSync(full).size });
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(bundle);
}

const totalBytes = allFiles.reduce((s, f) => s + f.size, 0);
const fmtMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fmtPct = (bytes: number) => `${((bytes / totalBytes) * 100).toFixed(1)}%`;
console.log(`总文件数：${allFiles.length}`);
console.log(`总体积：${fmtMB(totalBytes)}\n`);

// ========== 维度 1：顶层目录体积分布 ==========
console.log("━━━ 维度 1：顶层目录体积分布 ━━━");
{
  const top: Record<string, number> = {};
  for (const f of allFiles) {
    const rel = path.relative(bundle, f.path);
    const seg = rel.split(path.sep)[0] || "(root)";
    top[seg] = (top[seg] || 0) + f.size;
  }
  const sorted = Object.entries(top).sort((a, b) => b[1] - a[1]);
  for (const [name, size] of sorted) {
    console.log(`  ${name.padEnd(30)} ${fmtMB(size).padStart(12)}  ${fmtPct(size)}`);
  }
}

// ========== 维度 2：node_modules 子目录深度分布 ==========
console.log("\n━━━ 维度 2：node_modules 各位置体积 ━━━");
{
  const nmRoots: Record<string, number> = {};
  for (const f of allFiles) {
    const rel = path.relative(bundle, f.path);
    // 匹配所有 node_modules 段
    const parts = rel.split(path.sep);
    const idx = parts.indexOf("node_modules");
    if (idx === -1) continue;
    // 取 node_modules 及其上一层（区分顶层 / .next/node_modules / .pnpm/node_modules）
    const nmRoot = parts.slice(0, idx + 1).join("/");
    nmRoots[nmRoot] = (nmRoots[nmRoot] || 0) + f.size;
  }
  const sorted = Object.entries(nmRoots).sort((a, b) => b[1] - a[1]);
  for (const [name, size] of sorted) {
    console.log(`  ${name.padEnd(50)} ${fmtMB(size).padStart(12)}`);
  }
}

// ========== 维度 3：按删除规则分类体积 ==========
console.log("\n━━━ 维度 3：按删除规则分类（slimBundle 可优化空间）━━━");
{
  const rules: { name: string; match: (rel: string, base: string) => boolean }[] = [
    {
      name: "test/tests/__tests__ 目录",
      match: (rel) => /(^|\/)(test|tests|__tests__|__mocks__)\//.test(rel) || /(^|\/)(test|tests|__tests__|__mocks__)$/.test(rel),
    },
    { name: "*.test.js / *.spec.js", match: (rel, base) => /\.test\.[cm]?js$/.test(base) || /\.spec\.[cm]?js$/.test(base) },
    { name: "包内 docs/", match: (rel) => /node_modules\/.+\/docs?\//.test(rel) },
    { name: ".cache / node-gyp", match: (rel) => /(^|\/)\cache\//.test(rel) || /(^|\/)\.cache\//.test(rel) || /(^|\/)node-gyp\//.test(rel) },
    { name: "binding.gyp / yarn.lock / package-lock.json", match: (rel, base) => base === "binding.gyp" || base === "yarn.lock" || base === "package-lock.json" || base === "npm-shrinkwrap.json" },
    { name: "*.md / *.markdown", match: (rel, base) => base.endsWith(".md") || base.endsWith(".markdown") },
    { name: "*.d.ts / *.d.mts / *.d.cts", match: (rel, base) => /\.d\.[cm]?ts$/.test(base) },
    { name: "*.map (js/ts)", match: (rel, base) => base.endsWith(".js.map") || base.endsWith(".ts.map") },
    { name: "LICENSE / README / CHANGELOG", match: (rel, base) => base === "LICENSE" || base.startsWith("LICENSE.") || base.startsWith("LICENCE") || base === "README" || base.startsWith("README.") || base.startsWith("CHANGELOG") },
    { name: ".ts 源码（非声明）", match: (rel, base) => base.endsWith(".ts") && !/\.d\.ts$/.test(base) && !/\.test\.ts$/.test(base) && !/\.spec\.ts$/.test(base) },
    { name: ".bin 目录", match: (rel) => /(^|\/)\.bin\//.test(rel) || /(^|\/)\.bin$/.test(rel) },
    { name: "mermaid locales（非 zh/en）", match: (rel) => /mermaid\/.*\/dist\/locales\/(?!en|zh)/.test(rel) || /mermaid\/.*\/locales\/(?!en|zh)/.test(rel) },
    { name: "*.tgz", match: (rel, base) => base.endsWith(".tgz") },
    { name: " Flow / .flow / coverage", match: (rel) => /(^|\/)flow-typed\//.test(rel) || /(^|\/)\.flow$/.test(rel) || /(^|\/)coverage\//.test(rel) },
    { name: " examples/ example/", match: (rel) => /node_modules\/.+\/examples?\//.test(rel) },
    { name: "*.markdown（文档）", match: (rel, base) => base.endsWith(".markdown") },
  ];

  let totalRemovable = 0;
  for (const rule of rules) {
    let bytes = 0;
    let count = 0;
    for (const f of allFiles) {
      const rel = path.relative(bundle, f.path);
      const base = path.basename(f.path);
      if (rule.match(rel, base)) {
        bytes += f.size;
        count++;
      }
    }
    if (bytes > 0) {
      console.log(`  ${(rule.name + " ").padEnd(46, ".")} ${fmtMB(bytes).padStart(10)}  (${count} 个文件)`);
      totalRemovable += bytes;
    }
  }
  console.log(`  ${"=".repeat(46)} ${fmtMB(totalRemovable).padStart(10)}  总可删除`);
  console.log(`     ↑ 占总体积 ${fmtPct(totalRemovable)}（注：部分规则互斥，实际收益取最大子集）`);
}

// ========== 维度 4：包重复检测 ==========
console.log("\n━━━ 维度 4：包重复检测（相同 package@version 多副本）━━━");
{
  // 收集所有 node_modules 下的包目录（含 package.json）
  const packages: { name: string; version: string; dir: string; size: number; fileCount: number }[] = [];
  const visited = new Set<string>();

  const findPackages = (nmDir: string) => {
    let scoped: string[];
    try {
      scoped = fs.readdirSync(nmDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of scoped) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      if (e.name.startsWith(".")) continue;
      let pkgDir: string;
      if (e.name.startsWith("@")) {
        // scoped: 读下一层
        const scopeDir = path.join(nmDir, e.name);
        let subs: fs.Dirent[];
        try {
          subs = fs.readdirSync(scopeDir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const sub of subs) {
          if (!sub.isDirectory() && !sub.isSymbolicLink()) continue;
          pkgDir = path.join(scopeDir, sub.name);
          if (visited.has(pkgDir)) continue;
          visited.add(pkgDir);
          readPkg(pkgDir, `${e.name}/${sub.name}`);
        }
      } else {
        pkgDir = path.join(nmDir, e.name);
        if (visited.has(pkgDir)) continue;
        visited.add(pkgDir);
        readPkg(pkgDir, e.name);
      }
    }
  };

  const readPkg = (pkgDir: string, nameHint: string) => {
    const pjPath = path.join(pkgDir, "package.json");
    if (!fs.existsSync(pjPath)) return;
    let pj: { name?: string; version?: string };
    try {
      pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
    } catch {
      return;
    }
    const name = pj.name || nameHint;
    const version = pj.version || "?";
    // 算体积
    let size = 0;
    let fileCount = 0;
    const walk = (d: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.isFile()) {
          try {
            size += fs.statSync(full).size;
            fileCount++;
          } catch {}
        }
      }
    };
    walk(pkgDir);
    packages.push({ name, version, dir: pkgDir, size, fileCount });
  };

  // 扫所有 node_modules 位置（不递归进包内部再找 node_modules，避免重复）
  const scanNmLocations = () => {
    const queue = [bundle];
    const found: string[] = [];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const dir = queue.shift()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const full = path.join(dir, e.name);
        if (e.name === "node_modules") {
          found.push(full);
          // 不继续往 node_modules 内部递归找（会找到 .pnpm/node_modules 等，交给主循环）
        } else if (e.name === ".next" || e.name === ".pnpm") {
          // 进入这些目录继续找
          queue.push(full);
        } else if (!e.name.startsWith(".")) {
          // 其他普通目录，也递归找（某些包内可能 bundle 了依赖）
          queue.push(full);
        }
      }
    }
    return found;
  };

  const nmLocations = scanNmLocations();
  console.log(`  扫描 ${nmLocations.length} 个 node_modules 位置…`);
  for (const loc of nmLocations) findPackages(loc);

  console.log(`  共发现 ${packages.length} 个包目录`);

  // 按 name@version 分组
  const groups: Record<string, typeof packages> = {};
  for (const p of packages) {
    const key = `${p.name}@${p.version}`;
    (groups[key] ||= []).push(p);
  }

  // 找出重复的
  const dups = Object.entries(groups)
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].reduce((s, p) => s + p.size, 0) - a[1].reduce((s, p) => s + p.size, 0));

  let dupTotalBytes = 0;
  let dupCount = 0;
  console.log(`\n  Top 30 重复包（按重复占用的总字节降序）：`);
  console.log(`  ${"包@版本".padEnd(50)} 副本数  单副本大小  冗余（副本数-1）*单副本`);
  for (const [key, list] of dups.slice(0, 30)) {
    const singleSize = list[0].size;
    const redundancy = singleSize * (list.length - 1);
    dupTotalBytes += redundancy;
    dupCount += list.length - 1;
    console.log(
      `  ${key.padEnd(50).slice(0, 50)} ${String(list.length).padStart(5)}  ${fmtMB(singleSize).padStart(10)}  ${fmtMB(redundancy).padStart(12)}`
    );
  }

  const allDupBytes = dups.reduce((sum, [, list]) => sum + list[0].size * (list.length - 1), 0);
  const allDupCount = dups.reduce((sum, [, list]) => sum + list.length - 1, 0);
  console.log(`\n  全部重复：${dups.length} 个包有多个副本，${allDupCount} 个冗余副本，冗余体积 ${fmtMB(allDupBytes)}`);
  console.log(`     ↑ 这是"路径不同但 package@version 相同"的副本。理论上可保留 1 份，其余让 Node require 回退解析`);
}

console.log("\n=== 扫描完成 ===\n");
