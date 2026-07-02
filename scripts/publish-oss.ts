#!/usr/bin/env tsx
/**
 * InkPress 发布产物上传 OSS 脚本。
 *
 * 将 dist/ 目录下的打包成品（DMG、blockmap、latest-mac.yml 等）上传到阿里云 OSS，
 * 同时写入版本归档目录和 latest 别名目录，供 electron-updater 自动更新使用。
 *
 * OSS 路径结构：
 *   {prefix}/releases/v{version}/InkPress-{version}-{arch}.dmg       ← 版本归档（不可变）
 *   {prefix}/releases/v{version}/InkPress-{version}-{arch}.dmg.blockmap
 *   {prefix}/releases/v{version}/latest-mac.yml
 *   {prefix}/releases/latest/InkPress-{version}-{arch}.dmg            ← 始终最新
 *   {prefix}/releases/latest/InkPress-{version}-{arch}.dmg.blockmap
 *   {prefix}/releases/latest/latest-mac.yml                           ← auto-update 入口
 *
 * 当未来支持多架构 / Windows / Linux 时，各自产物并列上传到同一目录，
 * latest-*.yml 文件名按 electron-builder 约定区分平台。
 *
 * 用法：
 *   pnpm publish:oss              # 上传 dist/ 产物到 OSS
 *   pnpm publish:oss --dry-run    # 预览上传路径，不实际上传
 *
 * 凭据来源：.env.publish（已被 .gitignore 的 .env* 规则忽略，不会提交）
 */
import OSS from "ali-oss";
import fs from "node:fs";
import path from "node:path";

// ───────────────────────── 常量 ─────────────────────────

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, ".env.publish");
const DIST_DIR = path.join(ROOT, "dist");

// ─────────────────────── env 加载 ───────────────────────

/**
 * 从 .env.publish 加载环境变量。
 * 支持以下格式：
 *   KEY=VALUE
 *   KEY="VALUE"
 *   export KEY=VALUE          （shell 兼容写法）
 *   # 注释 / 空行跳过
 */
function loadEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  const env: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice(7) : line;
    const eqIdx = stripped.indexOf("=");
    if (eqIdx < 0) continue;
    const key = stripped.slice(0, eqIdx).trim();
    let val = stripped.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) env[key] = val;
  }
  return env;
}

// ──────────────────── CLI 参数解析 ────────────────────

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

// ────────────────────── 主流程 ──────────────────────

async function main() {
  // 1. 加载凭据
  const env = loadEnvFile(ENV_FILE);

  const region = env.OSS_PUBLISH_REGION || process.env.OSS_PUBLISH_REGION;
  const bucket = env.OSS_PUBLISH_BUCKET || process.env.OSS_PUBLISH_BUCKET;
  const accessKeyId =
    env.OSS_PUBLISH_ACCESS_KEY_ID || process.env.OSS_PUBLISH_ACCESS_KEY_ID;
  const accessKeySecret =
    env.OSS_PUBLISH_ACCESS_KEY_SECRET ||
    process.env.OSS_PUBLISH_ACCESS_KEY_SECRET;
  const pathPrefix = (
    env.OSS_PUBLISH_PATH_PREFIX ||
    process.env.OSS_PUBLISH_PATH_PREFIX ||
    ""
  ).replace(/^\/+|\/+$/g, "");

  const missing = [
    ["OSS_PUBLISH_REGION", region],
    ["OSS_PUBLISH_BUCKET", bucket],
    ["OSS_PUBLISH_ACCESS_KEY_ID", accessKeyId],
    ["OSS_PUBLISH_ACCESS_KEY_SECRET", accessKeySecret],
  ].filter(([, v]) => !v?.trim());

  if (missing.length > 0) {
    console.error(
      `✗ .env.publish 缺少必填项：${missing.map(([k]) => k).join(", ")}\n` +
        `  请复制 .env.publish.example 为 .env.publish 并填入真实值：\n` +
        `    cp .env.publish.example .env.publish`
    );
    process.exit(1);
  }

  // 2. 读取版本号
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")
  );
  const version: string = pkg.version;
  if (!version) {
    console.error("✗ package.json 缺少 version 字段");
    process.exit(1);
  }

  // 3. 扫描 dist 产物
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`✗ dist 目录不存在，请先执行 pnpm electron:build:arm64`);
    process.exit(1);
  }

  const distFiles = fs.readdirSync(DIST_DIR);
  // 上传产物白名单：DMG 安装包、blockmap（增量更新用）、latest-*.yml（auto-update manifest）
  const artifacts = distFiles.filter(
    (name) => /\.(dmg|dmg\.blockmap)$/.test(name) || /^latest-.*\.yml$/.test(name)
  );

  if (artifacts.length === 0) {
    console.error(
      `✗ dist/ 目录下未找到打包产物（*.dmg / *.blockmap / latest-*.yml）\n` +
        `  请先执行 pnpm electron:build:arm64 生成安装包`
    );
    process.exit(1);
  }

  // 4. 构建 OSS 路径
  const releasesRoot = pathPrefix ? `${pathPrefix}/releases` : "releases";
  const versionDir = `${releasesRoot}/v${version}`;
  const latestDir = `${releasesRoot}/latest`;
  const baseUrl = `https://${bucket}.oss-cn-${region}.aliyuncs.com`;

  // 5. 打印预览
  console.log("═".repeat(64));
  console.log(`  InkPress 发布产物上传 OSS${dryRun ? "（DRY-RUN 预览）" : ""}`);
  console.log("═".repeat(64));
  console.log(`  版本        : v${version}`);
  console.log(`  Bucket      : ${bucket} (oss-cn-${region})`);
  console.log(`  产物数      : ${artifacts.length} 个文件`);
  console.log(`  版本归档    : ${versionDir}/`);
  console.log(`  最新别名    : ${latestDir}/`);
  console.log("─".repeat(64));
  console.log("  待上传文件：");
  for (const name of artifacts) {
    const size = fs.statSync(path.join(DIST_DIR, name)).size;
    console.log(`    • ${name} (${formatSize(size)})`);
  }
  console.log("─".repeat(64));

  if (dryRun) {
    console.log("\n  上传路径预览：");
    for (const name of artifacts) {
      console.log(`    ${versionDir}/${name}`);
      console.log(`    ${latestDir}/${name}`);
    }
    console.log(`\n  auto-update 入口 URL：`);
    console.log(`    ${baseUrl}/${latestDir}/latest-mac.yml`);
    console.log("\n✓ Dry-run 完成，未上传任何文件。去掉 --dry-run 执行实际上传。");
    return;
  }

  // 6. 初始化 OSS 客户端并上传
  const client = new OSS({
    region: `oss-cn-${region}`,
    accessKeyId: accessKeyId!,
    accessKeySecret: accessKeySecret!,
    bucket: bucket!,
    secure: true,
  });

  // 构建上传列表：每个产物 → 版本归档 + latest 别名
  const uploads: Array<{ key: string; file: string }> = [];
  for (const name of artifacts) {
    const localPath = path.join(DIST_DIR, name);
    uploads.push({ key: `${versionDir}/${name}`, file: localPath });
    uploads.push({ key: `${latestDir}/${name}`, file: localPath });
  }

  console.log(`\n  开始上传 ${uploads.length} 个对象...\n`);

  let ok = 0;
  let fail = 0;
  for (const { key, file } of uploads) {
    const shortKey = key.length > 72 ? "..." + key.slice(-69) : key;
    try {
      // OSS 简单上传（put）支持最大 5 GB，256 MB DMG 直接上传即可。
      // multipartUpload 在部分 Node 版本上有 content-length 不匹配的 bug，
      // 且 put 对单文件来说更可靠（无分片重试拼接问题）。
      await client.put(key, file);
      ok++;
      console.log(`  ✓ ${shortKey}`);
    } catch (err) {
      fail++;
      console.error(`  ✗ ${shortKey}`);
      console.error(`    → ${(err as Error).message}`);
    }
  }

  console.log("─".repeat(64));

  if (fail > 0) {
    console.error(
      `\n✗ 上传完成：${ok} 成功，${fail} 失败。请检查失败的条目后重试。`
    );
    process.exit(1);
  }

  console.log(`\n✓ 全部上传成功（${ok} 个对象）`);
  console.log("═".repeat(64));
  console.log(`  🎉 v${version} 已发布到 OSS`);
  console.log("═".repeat(64));
  console.log(`\n  auto-update 入口（供 electron-updater 检查）：`);
  console.log(`    ${baseUrl}/${latestDir}/latest-mac.yml`);
  console.log(`\n  版本归档目录：`);
  console.log(`    ${baseUrl}/${versionDir}/`);
}

// ────────────────────── 工具函数 ──────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main().catch((err) => {
  console.error(`\n✗ 上传失败：${err.message}`);
  process.exit(1);
});
