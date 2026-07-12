#!/usr/bin/env node
/**
 * CI 发布：上传安装包到 OSS + 登记 inkpress-service。
 *
 * 在 GitHub Actions 的 build job 中执行（DMG/EXE 构建后、runner 销毁前）。
 * 复用 inkpress 根目录已安装的 ali-oss 依赖，无需安装 inkpress-service。
 *
 * 做两件事：
 * 1. 上传 dist/ 中的安装包 + blockmap + latest*.yml 到 OSS（版本归档 + latest 别名）
 * 2. 对每个安装包（.dmg/.exe）调 /api/releases/register，写入 sha256/size/downloadUrl
 *    → 桌面端启动时调 /api/releases/check-update 检测新版本就靠这条记录
 *
 * 必需环境变量（从 GitHub Secrets 注入）：
 *   OSS_PUBLISH_REGION             OSS region（如 shanghai）
 *   OSS_PUBLISH_BUCKET             OSS bucket 名
 *   OSS_PUBLISH_ACCESS_KEY_ID      OSS AccessKey ID
 *   OSS_PUBLISH_ACCESS_KEY_SECRET  OSS AccessKey Secret
 *   RELEASE_REGISTER_TOKEN         inkpress-service 登记令牌
 *
 * 可选环境变量：
 *   INKPRESS_REGISTER_URL  登记 API 地址（默认 https://www.longoflow.com/api/releases/register）
 *   RELEASE_NOTES          changelog markdown（传入则随版本记录写入）
 */
import OSS from "ali-oss";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const START = Date.now();

// ─── env ───

const region = normalizeRegion(process.env.OSS_PUBLISH_REGION || "");
const bucket = process.env.OSS_PUBLISH_BUCKET || "";
const accessKeyId = process.env.OSS_PUBLISH_ACCESS_KEY_ID || "";
const accessKeySecret = process.env.OSS_PUBLISH_ACCESS_KEY_SECRET || "";
const registerToken = process.env.RELEASE_REGISTER_TOKEN || "";
const registerUrl =
  process.env.INKPRESS_REGISTER_URL ||
  "https://www.longoflow.com/api/releases/register";
const releaseNotes = process.env.RELEASE_NOTES || "";

// ─── version（root package.json，CI 中已由 sync-build-version.mjs 写入 tag 版本号）───

const rootDir = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"));
const version = pkg.version;
const displayName = pkg.productName || pkg.name || "InkPress";

if (!version) {
  console.error("✗ package.json 缺少 version 字段");
  process.exit(1);
}

// ─── validate ───

const missing = [
  ["OSS_PUBLISH_REGION", process.env.OSS_PUBLISH_REGION],
  ["OSS_PUBLISH_BUCKET", process.env.OSS_PUBLISH_BUCKET],
  ["OSS_PUBLISH_ACCESS_KEY_ID", process.env.OSS_PUBLISH_ACCESS_KEY_ID],
  ["OSS_PUBLISH_ACCESS_KEY_SECRET", process.env.OSS_PUBLISH_ACCESS_KEY_SECRET],
  ["RELEASE_REGISTER_TOKEN", process.env.RELEASE_REGISTER_TOKEN],
].filter(([, v]) => !v?.trim());

if (missing.length > 0) {
  console.error(
    `✗ 缺少环境变量：${missing.map(([k]) => k).join(", ")}\n` +
      `  在 GitHub repo Settings → Secrets and variables → Actions 中添加。`
  );
  process.exit(1);
}

// ─── scan dist/ ───

const distDir = path.join(rootDir, "dist");
if (!fs.existsSync(distDir)) {
  console.error(`✗ dist 目录不存在：${distDir}`);
  process.exit(1);
}

const allFiles = fs.readdirSync(distDir);

/** 上传到 OSS 的文件：安装包 + blockmap + latest*.yml */
const ossFiles = allFiles.filter(
  (name) =>
    /\.(dmg|exe)(\.blockmap)?$/.test(name) || /^latest.*\.yml$/.test(name)
);

/** 登记到 service 的文件：仅安装包（.dmg / .exe），不含 blockmap/yml */
const installerFiles = allFiles.filter((name) => /\.(dmg|exe)$/.test(name));

if (ossFiles.length === 0) {
  console.error(
    `✗ dist/ 下未找到打包产物（*.dmg / *.exe / *.blockmap / latest*.yml）`
  );
  process.exit(1);
}

// ─── header ───

console.log("═".repeat(64));
console.log(`  CI 发布：v${version}`);
console.log("═".repeat(64));
console.log(`  OSS bucket   : ${bucket} (oss-${region})`);
console.log(`  登记地址     : ${registerUrl}`);
console.log(`  上传文件     : ${ossFiles.length} 个`);
console.log(`  登记安装包   : ${installerFiles.length} 个`);
console.log("─".repeat(64));
for (const name of ossFiles) {
  const size = fs.statSync(path.join(distDir, name)).size;
  console.log(`  • ${name} (${formatSize(size)})`);
}
console.log("─".repeat(64));

const errors = [];

// ─── Step 1: Upload to OSS ───

console.log("\n▶ 上传到 OSS...");
const client = new OSS({
  region: `oss-${region}`,
  accessKeyId,
  accessKeySecret,
  bucket,
  secure: true,
});

const versionDir = `releases/v${version}`;
const latestDir = `releases/latest`;

for (const name of ossFiles) {
  const localPath = path.join(distDir, name);
  for (const prefix of [versionDir, latestDir]) {
    const key = `${prefix}/${name}`;
    try {
      await client.put(key, localPath);
      console.log(`  ✓ ${key}`);
    } catch (err) {
      console.error(`  ✗ ${key}`);
      console.error(`    → ${err.message}`);
      errors.push(`OSS: ${key}`);
    }
  }
}

// ─── Step 2: Register to inkpress-service ───

console.log("\n▶ 登记到 inkpress-service...");

for (const name of installerFiles) {
  const filePath = path.join(distDir, name);
  const stat = fs.statSync(filePath);
  const sha256 = await sha256OfFile(filePath);
  const platform = inferPlatform(name);
  const downloadUrl = `https://${bucket}.oss-${region}.aliyuncs.com/${versionDir}/${name}`;

  const payload = {
    packageName: "inkpress",
    platform,
    version,
    displayName,
    fileName: name,
    fileSizeBytes: stat.size,
    fileHashSha256: sha256,
    downloadUrl,
    channel: "stable",
    releasedAt: new Date().toISOString(),
  };
  if (releaseNotes) payload.changelogMarkdown = releaseNotes;

  try {
    const result = await registerWithRetry(payload, registerUrl, registerToken);
    console.log(
      `  ✓ ${platform.padEnd(14)} ${result.action === "created" ? "新建" : "更新"} ${name}`
    );
  } catch (err) {
    console.error(`  ✗ ${platform.padEnd(14)} ${name}`);
    console.error(`    → ${err.message}`);
    errors.push(`register: ${platform}`);
  }
}

// ─── summary ───

console.log("\n" + "═".repeat(64));
if (errors.length > 0) {
  console.error(`✗ 完成（${errors.length} 个失败，${Date.now() - START}ms）：`);
  for (const e of errors) console.error(`  • ${e}`);
  console.error(`\n  OSS 文件已上传成功；可修复后重跑（register 幂等）。`);
  process.exit(1);
}
console.log(`✓ v${version} 发布完成（${Date.now() - START}ms）`);
console.log(`  访问 https://www.longoflow.com/downloads 查看效果`);
console.log("═".repeat(64));

// ─── helpers ───

function normalizeRegion(raw) {
  let r = raw.trim().replace(/^oss-/, "");
  if (!r.includes("-")) r = `cn-${r}`;
  return r;
}

/** 从文件名推断平台。InkPress-{version}-{arch}.{ext} 是 electron-builder 默认 */
function inferPlatform(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".dmg")) {
    if (lower.includes("arm64") || lower.includes("-m1") || lower.includes("apple-silicon"))
      return "darwin-arm64";
    if (lower.includes("x64") || lower.includes("intel") || lower.includes("-64"))
      return "darwin-x64";
    return "darwin-arm64";
  }
  if (lower.endsWith(".exe")) return "win32-x64";
  if (lower.endsWith(".appimage") || lower.endsWith(".deb") || lower.endsWith(".rpm"))
    return "linux-x64";
  return "unknown";
}

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function registerWithRetry(payload, url, token) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const wait = Math.pow(2, attempt) * 1000;
      console.log(`  ↻ 第 ${attempt + 1} 次尝试（${wait}ms 后）...`);
      await new Promise((r) => setTimeout(r, wait));
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Release-Token": token,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data?.ok) return data.data;
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
