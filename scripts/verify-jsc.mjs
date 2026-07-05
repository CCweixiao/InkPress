#!/usr/bin/env node
/**
 * 校验 .app 内 server.jsc 与运行时 Electron 的 V8 roChecksum 是否一致。
 *
 * 用法（在目标 Mac 上跑，会自动定位已安装的 InkPress.app）：
 *   node scripts/verify-jsc.mjs                      # /Applications/InkPress.app
 *   node scripts/verify-jsc.mjs /path/to/InkPress.app
 *
 * 判定：
 * - runtime roChecksum（当前进程 Electron V8）= dummy cache offset 16 的 u32 LE
 * - on-disk server.jsc 内嵌 roChecksum = 文件 offset 16 的 u32 LE（V8 cache header 固定布局）
 * - 两者相等 → 加载时 cachedDataAccepted，server 子进程能启动
 * - 不等 → cachedDataRejected，子进程启动即退出（本次 v0.4.0 x64 包的根因）
 *
 * 注：V8 cached data header 布局在 V8 12.x+ 稳定，offset 16 = read-only snapshot checksum。
 * 若未来 V8 改 header，需要用 bytenode debug 模式交叉验证（BYTENODE_DEBUG=1）。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const appPath = process.argv[2] || "/Applications/InkPress.app";
const electronBin = path.join(appPath, "Contents/MacOS/InkPress");
const standaloneDir = path.join(appPath, "Contents/Resources/standalone");
const serverJsc = path.join(standaloneDir, "server.jsc");

if (!fs.existsSync(electronBin)) {
  console.error(`✗ 找不到 Electron 二进制: ${electronBin}`);
  process.exit(1);
}
if (!fs.existsSync(serverJsc)) {
  console.error(`✗ 找不到 server.jsc: ${serverJsc}`);
  console.error(`  该包可能未启用 bytecode 保护（明文 server.js）`);
  process.exit(1);
}

// 1) 当前 .app 自带 Electron 的 runtime roChecksum
const probe = `
const vm = require('vm');
const cd = new vm.Script('module.exports=1', { produceCachedData: true }).createCachedData();
process.stdout.write(JSON.stringify({
  arch: process.arch,
  electron: process.versions.electron,
  node: process.versions.node,
  v8: process.versions.v8,
  roChecksum: '0x' + cd.readUInt32LE(16).toString(16).padStart(8, '0')
}));
`;
const rt = spawnSync(electronBin, ["-e", probe], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  encoding: "utf8",
});
if (rt.status !== 0) {
  console.error(`✗ 探测 runtime 失败:\n${rt.stderr || rt.stdout}`);
  process.exit(rt.status ?? 1);
}
const runtime = JSON.parse(rt.stdout);

// 2) on-disk server.jsc 内嵌的 roChecksum（同布局，offset 16）
const jscBuf = fs.readFileSync(serverJsc);
const onDisk = {
  roChecksum: "0x" + jscBuf.readUInt32LE(16).toString(16).padStart(8, "0"),
  sizeMB: (jscBuf.length / 1024 / 1024).toFixed(1),
};

console.log("═".repeat(56));
console.log(`  目标 .app       : ${appPath}`);
console.log(`  server.jsc 大小 : ${onDisk.sizeMB} MB`);
console.log("─".repeat(56));
console.log(`  runtime         : arch=${runtime.arch} electron=${runtime.electron} v8=${runtime.v8}`);
console.log(`  runtime roChecksum : ${runtime.roChecksum}`);
console.log(`  on-disk roChecksum : ${onDisk.roChecksum}`);
console.log("─".repeat(56));

if (runtime.roChecksum === onDisk.roChecksum) {
  console.log(`  ✓ 一致：server.jsc 可被当前 .app 的 Electron 加载`);
  process.exit(0);
} else {
  console.log(`  ✗ 不一致：server.jsc 是用其它架构/版本的 Electron 编译的`);
  console.log(`    → 加载时 V8 会报 cachedDataRejected，server 子进程启动即退出`);
  console.log(`    → 这就是 v0.4.0 x64 包在 Intel Mac 上安装失败的根因`);
  process.exit(2);
}
