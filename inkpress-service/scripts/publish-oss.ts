#!/usr/bin/env tsx
/**
 * InkPress 发布产物上传 OSS 脚本（inkpress-service 工具体系内）。
 *
 * 把 inkpress/dist/ 目录下的 electron 打包产物上传到阿里云 OSS，
 * 同时写入版本归档目录和 latest 别名目录，供 electron-updater 自动更新使用。
 *
 * OSS 路径结构（专用 bucket，无前缀）：
 *   releases/v{version}/InkPress-{version}-{arch}.dmg       ← 版本归档（不可变）
 *   releases/v{version}/InkPress-{version}-{arch}.dmg.blockmap
 *   releases/v{version}/latest-mac.yml
 *   releases/latest/InkPress-{version}-{arch}.dmg            ← 始终最新
 *   releases/latest/InkPress-{version}-{arch}.dmg.blockmap
 *   releases/latest/latest-mac.yml                           ← auto-update 入口
 *
 * 配置来源：inkpress-service/.env.production（OSS_PUBLISH_* 系列）
 * dist 来源：默认 ../dist（inkpress 根目录），可用 --dist 覆盖
 *
 * 用法：
 *   pnpm publish:oss                       # 上传 ../dist/ 产物
 *   pnpm publish:oss --dist /path/to/dist  # 指定 dist 目录
 *   pnpm publish:oss --dry-run             # 预览，不实际上传
 */
import OSS from "ali-oss";
import fs from "node:fs";
import path from "node:path";

// ───────────────────────── 常量 ─────────────────────────

const SCRIPT_DIR = __dirname;
const SERVICE_ROOT = path.resolve(SCRIPT_DIR, "..");
const ENV_FILE = path.join(SERVICE_ROOT, ".env.production");

// ─────────────────────── env 加载 ───────────────────────

/**
 * 从 .env.production 加载环境变量。
 * 复用 inkpress-service 的 OSS 配置（单一来源）。
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

// ──────────────────── region 规范化 ────────────────────

/**
 * 把多种 region 写法统一成 ali-oss SDK 需要的格式。
 *   "shanghai" / "cn-shanghai" / "oss-cn-shanghai" → "cn-shanghai"
 * 然后 SDK 接受 region: "oss-cn-shanghai" 或 endpoint 拼接。
 */
function normalizeRegion(raw: string): string {
  let r = raw.trim().replace(/^oss-/, "");
  if (!r.includes("-")) {
    r = `cn-${r}`;
  }
  return r;
}

// ──────────────────── CLI 参数解析 ────────────────────

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

function getArg(name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return argv[idx + 1];
}

// ────────────────────── 主流程 ──────────────────────

async function main() {
  // 1. 加载凭据（来自 inkpress-service/.env.production）
  const env = loadEnvFile(ENV_FILE);

  const regionRaw = env.OSS_PUBLISH_REGION || process.env.OSS_PUBLISH_REGION;
  const bucket = env.OSS_PUBLISH_BUCKET || process.env.OSS_PUBLISH_BUCKET;
  const accessKeyId =
    env.OSS_PUBLISH_ACCESS_KEY_ID || process.env.OSS_PUBLISH_ACCESS_KEY_ID;
  const accessKeySecret =
    env.OSS_PUBLISH_ACCESS_KEY_SECRET ||
    process.env.OSS_PUBLISH_ACCESS_KEY_SECRET;

  const missing = [
    ["OSS_PUBLISH_REGION", regionRaw],
    ["OSS_PUBLISH_BUCKET", bucket],
    ["OSS_PUBLISH_ACCESS_KEY_ID", accessKeyId],
    ["OSS_PUBLISH_ACCESS_KEY_SECRET", accessKeySecret],
  ].filter(([, v]) => !v?.trim());

  if (missing.length > 0) {
    console.error(
      `✗ inkpress-service/.env.production 缺少 OSS 配置：${missing
        .map(([k]) => k)
        .join(", ")}\n` +
        `  请检查 inkpress-service/.env.production 是否包含 OSS_PUBLISH_* 系列。`
    );
    process.exit(1);
  }

  const region = normalizeRegion(regionRaw!);

  // 2. 读取版本号（inkpress 根目录的 package.json）
  const inkpressRoot = path.resolve(SERVICE_ROOT, "..");
  const inkpressPkgPath = path.join(inkpressRoot, "package.json");
  if (!fs.existsSync(inkpressPkgPath)) {
    console.error(
      `✗ 找不到 inkpress/package.json（期望路径：${inkpressPkgPath}）\n` +
        `  本脚本应在 inkpress-service 目录下运行。`
    );
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(inkpressPkgPath, "utf-8"));
  const version: string = pkg.version;
  if (!version) {
    console.error("✗ inkpress/package.json 缺少 version 字段");
    process.exit(1);
  }

  // 3. 定位 dist 目录（默认 inkpress/dist，可用 --dist 覆盖）
  const distArg = getArg("dist");
  const distDir = distArg
    ? path.resolve(distArg)
    : path.join(inkpressRoot, "dist");

  if (!fs.existsSync(distDir)) {
    console.error(
      `✗ dist 目录不存在：${distDir}\n` +
        `  请先在 inkpress 根目录执行 pnpm electron:build:arm64，\n` +
        `  或用 --dist 参数指定其他路径。`
    );
    process.exit(1);
  }

  // 4. 扫描打包产物
  const distFiles = fs.readdirSync(distDir);
  const artifacts = distFiles.filter(
    (name) => /\.(dmg|dmg\.blockmap)$/.test(name) || /^latest-.*\.yml$/.test(name)
  );

  if (artifacts.length === 0) {
    console.error(
      `✗ ${distDir} 下未找到打包产物（*.dmg / *.blockmap / latest-*.yml）\n` +
        `  请先执行 pnpm electron:build:arm64 生成安装包`
    );
    process.exit(1);
  }

  // 5. 构建 OSS 路径（专用 bucket，无前缀）
  const versionDir = `releases/v${version}`;
  const latestDir = `releases/latest`;
  const baseUrl = `https://${bucket}.oss-${region}.aliyuncs.com`;

  // 6. 打印预览
  console.log("═".repeat(64));
  console.log(`  InkPress 发布产物上传 OSS${dryRun ? "（DRY-RUN 预览）" : ""}`);
  console.log("═".repeat(64));
  console.log(`  版本        : v${version}`);
  console.log(`  Bucket      : ${bucket} (oss-${region})`);
  console.log(`  dist 来源   : ${distDir}`);
  console.log(`  产物数      : ${artifacts.length} 个文件`);
  console.log(`  版本归档    : ${versionDir}/`);
  console.log(`  最新别名    : ${latestDir}/`);
  console.log("─".repeat(64));
  console.log("  待上传文件：");
  for (const name of artifacts) {
    const size = fs.statSync(path.join(distDir, name)).size;
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

  // 7. 初始化 OSS 客户端并上传
  const client = new OSS({
    region: `oss-${region}`,
    accessKeyId: accessKeyId!,
    accessKeySecret: accessKeySecret!,
    bucket: bucket!,
    secure: true,
  });

  // 构建上传列表：每个产物 → 版本归档 + latest 别名
  const uploads: Array<{ key: string; file: string }> = [];
  for (const name of artifacts) {
    const localPath = path.join(distDir, name);
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
  console.log(`\n  下一步：pnpm release:register 登记到 /downloads 页面`);
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
