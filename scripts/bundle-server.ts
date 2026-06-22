/**
 * PoC：用 esbuild bundle Next.js standalone server.js。
 *
 * 目标：把 925 MB 的 node_modules 压成单个 bundle 文件，
 * 只保留原生模块等 externals 在 node_modules 里。
 *
 * 用法：pnpm tsx scripts/bundle-server.ts
 */
import { buildSync, analyzeMetafileSync } from "esbuild";
import path from "node:path";
import fs from "node:fs";

const root = process.cwd();
const bundle = path.join(root, ".next", "standalone-bundle");
const serverJs = path.join(bundle, "server.js");
const outFile = path.join(bundle, "server.bundle.js");

if (!fs.existsSync(serverJs)) {
  console.error(`✗ 找不到 server.js：${serverJs}`);
  process.exit(1);
}

// Next.js serverExternalPackages（next.config.ts）—— 这些包必须保持 external
// 因为它们用了 native module 或 dynamic require，esbuild 无法 bundle
const serverExternals = [
  "better-sqlite3",
  "@prisma/adapter-better-sqlite3",
  "@prisma/client",
  "adm-zip",
  "ali-oss",
];

console.log("开始 esbuild bundle…");

const startMs = Date.now();
const result = buildSync({
  entryPoints: [serverJs],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: outFile,
  external: [
    ...serverExternals,
    // Node 原生模块（better_sqlite3.node 等）
    "*.node",
    // Next.js 运行时动态加载 .next/server/ 下的 chunks（保留原文件，不 bundle）
    "./.next/*",
    "../.next/*",
    ".next/*",
  ],
  logLevel: "warning",
  write: true,
  metafile: true,
  allowOverwrite: true,
  legalComments: "none",
});

if (result.warnings.length > 0) {
  console.log(`\n=== ⚠ ${result.warnings.length} 条警告 ===`);
  for (const w of result.warnings.slice(0, 30)) {
    console.log(`  - ${w.text}`);
    if (w.location) {
      console.log(`    @ ${w.location.file}:${w.location.line}:${w.location.column}`);
    }
  }
  if (result.warnings.length > 30) {
    console.log(`  …还有 ${result.warnings.length - 30} 条警告未显示`);
  }
}

if (result.errors.length > 0) {
  console.log(`\n=== ✗ ${result.errors.length} 条错误 ===`);
  for (const e of result.errors.slice(0, 10)) {
    console.log(`  - ${e.text}`);
    if (e.location) {
      console.log(`    @ ${e.location.file}:${e.location.line}:${e.location.column}`);
    }
  }
  process.exit(1);
}

const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
console.log(`\n✓ bundle 完成（${elapsed}s）：${path.relative(root, outFile)}`);
const sizeStat = fs.statSync(outFile);
console.log(`  bundle 大小：${(sizeStat.size / 1024 / 1024).toFixed(1)} MB`);

// 体积分析
console.log("\n=== Top 30 体积占用 ===");
if (result.metafile) {
  const stats = analyzeMetafileSync(result.metafile, {});
  console.log(stats.slice(0, 4000));
}
