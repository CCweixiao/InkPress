#!/usr/bin/env tsx
/**
 * InkPress 版本登记脚本。
 *
 * 扫描 dist/ 目录下的安装包（.dmg / .exe / .AppImage），
 * 计算文件元信息（大小、SHA256），POST 到 inkpress-service 的
 * /api/releases/register 接口。同版本号重发会 upsert 覆盖。
 *
 * 鉴权：X-Release-Token（共享密钥），与 inkpress-service 的
 * .env.production 中 RELEASE_REGISTER_TOKEN 完全一致。
 *
 * 失败重试：指数退避 3 次。OSS 上传成功但登记失败时不视为发布失败
 * （包已在 OSS，可手动重跑此脚本）。
 *
 * 用法：
 *   pnpm release:register                     # 登记 dist/ 下所有安装包
 *   pnpm release:register --platform darwin-arm64
 *   pnpm release:register --notes "$(cat CHANGELOG.md)"
 *   pnpm release:register --highlights "特性1" --highlights "特性2"
 *   pnpm release:register --dry-run           # 预览不调接口
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ────────────────────── env 加载 ──────────────────────

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, ".env.publish");

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

// ────────────────────── CLI ──────────────────────

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

function getArg(name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return argv[idx + 1];
}

function getArgList(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && i + 1 < argv.length) {
      out.push(argv[++i]!);
    }
  }
  return out;
}

// ────────────────────── 主流程 ──────────────────────

interface Artifact {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  fileHashSha256: string;
  platform: string;
  arch: string;
}

/** 从文件名推断平台/架构。InkPress-{version}-{arch}.{ext} 是 electron-builder 默认 */
function inferPlatform(fileName: string): { platform: string; arch: string } {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".dmg")) {
    if (lower.includes("arm64") || lower.includes("-m1") || lower.includes("-apple-silicon"))
      return { platform: "darwin-arm64", arch: "arm64" };
    if (lower.includes("x64") || lower.includes("intel") || lower.includes("-64"))
      return { platform: "darwin-x64", arch: "x64" };
    // 默认假设 arm64（当前主推）
    return { platform: "darwin-arm64", arch: "arm64" };
  }
  if (lower.endsWith(".exe")) return { platform: "win32-x64", arch: "x64" };
  if (lower.endsWith(".appimage")) return { platform: "linux-x64", arch: "x64" };
  if (lower.endsWith(".deb") || lower.endsWith(".rpm")) return { platform: "linux-x64", arch: "x64" };
  return { platform: "unknown", arch: "unknown" };
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

async function collectArtifacts(distDir: string, platformFilter?: string): Promise<Artifact[]> {
  const files = fs.readdirSync(distDir);
  const installers = files.filter(
    (name) => /\.(dmg|exe|appimage|deb|rpm)$/i.test(name) && !name.endsWith(".blockmap")
  );
  const artifacts: Artifact[] = [];
  for (const name of installers) {
    const filePath = path.join(distDir, name);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;
    const { platform, arch } = inferPlatform(name);
    if (platformFilter && platform !== platformFilter) continue;
    const fileHashSha256 = await sha256OfFile(filePath);
    artifacts.push({
      fileName: name,
      filePath,
      fileSizeBytes: stat.size,
      fileHashSha256,
      platform,
      arch,
    });
  }
  return artifacts;
}

function buildDownloadUrl(env: Record<string, string>, version: string, fileName: string): string {
  const region = env.OSS_PUBLISH_REGION;
  const bucket = env.OSS_PUBLISH_BUCKET;
  const prefix = (env.OSS_PUBLISH_PATH_PREFIX || "").replace(/^\/+|\/+$/g, "");
  const releasesRoot = prefix ? `${prefix}/releases` : "releases";
  return `https://${bucket}.oss-cn-${region}.aliyuncs.com/${releasesRoot}/v${version}/${fileName}`;
}

async function registerOne(
  payload: Record<string, unknown>,
  url: string,
  token: string
): Promise<{ action: string; id: string }> {
  const lastErr: Error[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
    if (attempt > 0) {
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
      if (res.ok && data?.ok) {
        return data.data;
      }
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    } catch (err) {
      lastErr.push(err as Error);
    }
  }
  throw new Error(`重试 3 次后仍失败：${lastErr[lastErr.length - 1]?.message}`);
}

async function main() {
  const env = loadEnvFile(ENV_FILE);
  const registerUrl =
    env.RELEASE_REGISTER_URL || process.env.RELEASE_REGISTER_URL;
  const token = env.RELEASE_REGISTER_TOKEN || process.env.RELEASE_REGISTER_TOKEN;

  if (!registerUrl || !token) {
    console.error(
      "✗ .env.publish 缺少 RELEASE_REGISTER_URL 或 RELEASE_REGISTER_TOKEN\n" +
        "  请编辑 .env.publish 填入（参考 .env.publish.example）"
    );
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
  const version: string = pkg.version;
  const displayName: string = pkg.productName || pkg.name || "InkPress";

  const distDir = path.join(ROOT, "dist");
  if (!fs.existsSync(distDir)) {
    console.error(`✗ dist/ 目录不存在，请先 pnpm electron:build:arm64`);
    process.exit(1);
  }

  const platformFilter = getArg("platform");
  const notes = getArg("notes");
  const highlights = getArgList("highlights");

  const artifacts = await collectArtifacts(distDir, platformFilter);
  if (artifacts.length === 0) {
    console.error(
      `✗ dist/ 下未找到安装包${platformFilter ? `（platform=${platformFilter}）` : ""}\n` +
        `  支持的扩展名：.dmg / .exe / .AppImage / .deb / .rpm`
    );
    process.exit(1);
  }

  console.log("═".repeat(64));
  console.log(`  InkPress 版本登记${dryRun ? "（DRY-RUN）" : ""}`);
  console.log("═".repeat(64));
  console.log(`  版本        : v${version}`);
  console.log(`  显示名      : ${displayName}`);
  console.log(`  登记地址    : ${registerUrl}`);
  console.log(`  产物数      : ${artifacts.length}`);
  console.log("─".repeat(64));
  for (const a of artifacts) {
    console.log(
      `  • ${a.platform.padEnd(14)} ${a.fileName} (${formatSize(a.fileSizeBytes)})`
    );
    console.log(`    sha256: ${a.fileHashSha256}`);
  }
  console.log("─".repeat(64));

  if (dryRun) {
    console.log("\n  请求体预览：");
    for (const a of artifacts) {
      const payload = buildPayload({
        artifact: a,
        version,
        displayName,
        downloadUrl: buildDownloadUrl(env, version, a.fileName),
        notes,
        highlights,
      });
      console.log(JSON.stringify(payload, null, 2));
    }
    console.log("\n✓ Dry-run 完成，未调用登记接口。去掉 --dry-run 执行实际登记。");
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const a of artifacts) {
    const payload = buildPayload({
      artifact: a,
      version,
      displayName,
      downloadUrl: buildDownloadUrl(env, version, a.fileName),
      notes,
      highlights,
    });
    try {
      const result = await registerOne(payload, registerUrl, token);
      ok++;
      console.log(
        `  ✓ ${a.platform.padEnd(14)} ${result.action === "created" ? "新建" : "更新"} id=${result.id}`
      );
    } catch (err) {
      fail++;
      console.error(`  ✗ ${a.platform.padEnd(14)} ${(err as Error).message}`);
    }
  }

  console.log("─".repeat(64));
  if (fail > 0) {
    console.error(`\n⚠ 登记：${ok} 成功，${fail} 失败。`);
    console.error(`  OSS 文件已上传成功；可修复后重跑 pnpm release:register（幂等）。`);
    process.exit(1);
  }

  console.log(`\n✓ 全部登记成功（${ok} 个平台）`);
  console.log(`  访问 https://www.longoflow.com/downloads 查看效果`);
}

function buildPayload(opts: {
  artifact: Artifact;
  version: string;
  displayName: string;
  downloadUrl: string;
  notes?: string;
  highlights: string[];
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    packageName: "inkpress",
    platform: opts.artifact.platform,
    version: opts.version,
    displayName: opts.displayName,
    fileName: opts.artifact.fileName,
    fileSizeBytes: opts.artifact.fileSizeBytes,
    fileHashSha256: opts.artifact.fileHashSha256,
    downloadUrl: opts.downloadUrl,
    channel: "stable",
    releasedAt: new Date().toISOString(),
  };
  if (opts.notes) payload.changelogMarkdown = opts.notes;
  if (opts.highlights.length > 0) payload.highlights = opts.highlights;
  return payload;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
