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
 * 双架构发布请走 GitHub Actions（release.yml 双 runner 原生构建），
 * 勿在本机一次命令打两个架构——standalone bundle 内的 .node 只能匹配一种 CPU。
 */
import { spawnSync } from "node:child_process";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";

/**
 * 加载本地 .env.apple（已被 .gitignore 忽略）：Apple 签名 / 公证凭据。
 * electron-builder 公证时从环境变量读取 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD。
 * 仅在文件存在时加载，缺失则跳过（开发期未配置签名时仍可打包未签名产物）。
 */
const envFile = path.join(process.cwd(), ".env.apple");
if (fs.existsSync(envFile)) {
  let loaded = 0;
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*export\s+([A-Z_]+)="?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2];
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
  console.warn(
    `\n⚠  跨架构打包（${hostArch} → ${targetArch}）：better-sqlite3 将 cross-compile。` +
      `\n   Intel 包请在 x64 Mac / macos-13 runner 上构建；M 系包请在 arm64 Mac 上构建。\n`
  );
}

const archEnv = { INKPRESS_TARGET_ARCH: targetArch };

run("pnpm", ["build"], archEnv);
run("pnpm", ["tsx", "scripts/prepare-standalone.ts"], archEnv);
run("pnpm", ["electron:compile"]);
run("pnpm", ["exec", "electron-builder", "--mac", `--${targetArch}`, "--publish", "never"]);

console.log(`\n✓ 打包完成（${targetArch}）。产物见 dist/`);
