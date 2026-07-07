#!/usr/bin/env node
/**
 * InkPress Electron 本地打包入口（按目标 CPU 架构单包构建）。
 *
 * 用法：
 *   pnpm electron:build              # 本机架构（M 系 → arm64，Intel → x64）
 *   pnpm electron:build --arm64      # 强制 Apple Silicon
 *   pnpm electron:build --x64        # 强制 Intel
 *   pnpm electron:build --arch arm64 # 同上，长参数形式
 *
 * 流程：next build → prepare-standalone（按目标 arch 重编 better-sqlite3）
 *       → tsc electron → electron-builder --mac --<arch>
 *
 * 仅允许本机架构打包（targetArch === hostArch），跨架构直接 exit(1)。
 * 根因：bytenode 编 server.jsc 用的是 node_modules/electron（host arch），
 * 跨架构时 .app 里 Electron 的 V8 read-only snapshot checksum（roChecksum）
 * 与 .jsc 内嵌的 cache header 不一致 → V8 cachedDataRejected → server 子进程启动即退出。
 * 此外 standalone bundle 内的 better-sqlite3 .node 也只匹配 host 架构。
 * 双架构发布走 GitHub Actions（release.yml 双 runner 原生构建）。
 */
import { spawnSync } from "node:child_process";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";

/**
 * 加载本地 .env.apple（已被 .gitignore 忽略）：Apple 签名 / 公证凭据。
 * electron-builder 签名 / 公证时从环境变量读取 CSC_NAME / APPLE_ID 等凭据。
 * 仅在文件存在时加载，缺失则跳过（开发期未配置签名时仍可打包未签名产物）。
 */
const envFile = path.join(process.cwd(), ".env.apple");
if (fs.existsSync(envFile)) {
  let loaded = 0;
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const m = trimmed.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[m[1]] = value;
      loaded++;
    }
  }
  if (loaded > 0) console.log(`  ✓ 已加载 .env.apple（${loaded} 个 Apple 凭据）`);
}

const VALID = new Set(["arm64", "x64"]);

/** @param {string[]} argv */
function parseTargetArch(argv) {
  const flag = argv.find((a) => a === "--arm64" || a === "--x64");
  if (flag) return flag.slice(2);

  const longIdx = argv.indexOf("--arch");
  if (longIdx !== -1) {
    const value = argv[longIdx + 1];
    if (value && VALID.has(value)) return value;
    console.error(`✗ 非法 --arch 值：${value ?? "（缺失）"}，可选 arm64 | x64`);
    process.exit(1);
  }

  // 默认：本机架构
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x64";
  console.error(`✗ 不支持的本机架构：${process.arch}`);
  process.exit(1);
}

/** @param {string} cmd @param {string[]} args @param {Record<string, string>} [extraEnv] */
function run(cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const targetArch = parseTargetArch(process.argv.slice(2));
const hostArch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;

console.log("═".repeat(56));
console.log(`  InkPress Electron 打包`);
console.log(`  目标架构 : ${targetArch}`);
console.log(`  本机架构 : ${hostArch}`);
console.log("═".repeat(56));

if (targetArch !== hostArch) {
  console.error(
    `\n✗ 拒绝跨架构打包（host=${hostArch} → target=${targetArch}）。\n` +
      `  bytenode 编 server.jsc 用的是 node_modules/electron（host = ${hostArch}），\n` +
      `  而 electron-builder --${targetArch} 把 ${targetArch} Electron 装进 .app，\n` +
      `  两端 V8 roChecksum 不一致 → 目标机器加载 server.jsc 时报 cachedDataRejected，\n` +
      `  server 子进程启动即退出。better-sqlite3 .node 同样只匹配 host 架构。\n\n` +
      `  请改用原生构建：Intel 包 → x64 Mac / macos-13 runner；M 系包 → arm64 Mac。\n` +
      `  双架构发布请走 GitHub Actions（release.yml 双 runner 原生构建）。\n`
  );
  process.exit(1);
}

const archEnv = { INKPRESS_TARGET_ARCH: targetArch };

run("pnpm", ["build"], archEnv);
run("pnpm", ["tsx", "scripts/prepare-standalone.ts"], archEnv);
run("pnpm", ["electron:compile"]);
run("pnpm", ["exec", "electron-builder", "--mac", `--${targetArch}`, "--publish", "never"]);

console.log(`\n✓ 打包完成（${targetArch}）。产物见 dist/`);
