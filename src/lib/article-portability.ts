import { z } from "zod";
import AdmZip from "adm-zip";
import matter from "front-matter";
import { TITLE_REGEX } from "@/lib/validation";

// ────────────────────────────────────────────────────────────────────────────
// 文章导出 / 导入（ZIP 搬家）
//
// 目标：把一篇文章（正文 MD + 元数据 + 素材）打成 ZIP，在另一个空间/实例还原。
//
// ZIP 布局（扁平）：
//   article.md       正文 Markdown（导出时为屏幕最新内容）
//   article.json     文章元数据
//   materials.json   素材列表元数据
//   assets/<id>-<name>.<ext>   仅本地素材的二进制（云素材不入此目录）
//
// 素材二进制策略（与用户约定）：
// - url 是 http(s)://（云存储）→ 仅元数据，URL 本身可移植；
// - url 指向本地（/api/storage/<id>）→ 打包二进制，导入时重新上传并把正文旧 URL 改写到新 URL。
//
// 本文件是纯/可测核心：打包、解析（含安全校验）、链接改写。DB / 存储读写由调用方（API 路由）完成。
// ────────────────────────────────────────────────────────────────────────────

export const EXPORT_SCHEMA_VERSION = 1;

export const ARTICLE_META_FILE = "article.json";
export const ARTICLE_MD_FILE = "article.md";
export const MATERIALS_FILE = "materials.json";
export const ASSETS_DIR = "assets";

/** 单个解压条目上限 50MB；解压后总上限 200MB（防炸弹） */
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const ASSET_ENTRY_RE = /^assets\/[^/]+$/;

// ── Schemas（宽松：未知字段忽略，字段全可选，便于向前兼容） ──────────────────

export const articleMetaSchema = z.object({
  schemaVersion: z.number().optional(),
  app: z.string().optional(),
  exportedAt: z.string().optional(),
  title: z.string().max(200).optional(),
  digest: z.string().optional(),
  status: z.string().optional(),
  profileId: z.string().optional(),
  themeId: z.string().optional(),
  coverUrl: z.string().optional(),
  createdAt: z.string().optional(),
});
export type ArticleMeta = z.infer<typeof articleMetaSchema>;

export const materialItemSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  kind: z.string().optional(),
  size: z.number().optional(),
  contentType: z.string().optional(),
  /** 原 URL —— 本地素材的正文链接改写 key */
  url: z.string().optional(),
  /** 云素材引用重建时用 */
  ossKey: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** 本地素材：assets/<name>；云素材缺省 */
  binary: z.string().optional(),
});
export type MaterialItem = z.infer<typeof materialItemSchema>;

export const materialsManifestSchema = z.object({
  schemaVersion: z.number().optional(),
  items: z.array(materialItemSchema).default([]),
});

// ── 导出侧类型（路由把 Prisma 行映射成这些） ──────────────────────────────────

export type ArticleExportMeta = {
  title: string;
  digest?: string | null;
  status?: string | null;
  profileId?: string | null;
  themeId?: string | null;
  coverUrl?: string | null;
  createdAt?: Date | string | null;
};

export type ExportMaterialMeta = {
  id: string;
  name: string;
  kind: string;
  size: number;
  contentType: string;
  url: string;
  ossKey: string;
  description: string;
  tags: string[];
  metadata: Record<string, unknown>;
  /** 本地素材：assets/ 内相对路径；云素材：undefined */
  binary?: string;
};

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

/** url 是否为可移植的云 URL（http/https）。否则视为本地存储引用。 */
export function isCloudAssetUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** 生成本地素材在 ZIP 内的二进制路径：assets/<assetId>-<safeName>（assetId 保证唯一） */
export function assetBinaryPath(assetId: string, displayName: string): string {
  const safe =
    (displayName || "asset")
      .replace(/[^\w.\-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "asset";
  return `${ASSETS_DIR}/${assetId}-${safe}`;
}

/**
 * 打包导出 ZIP。binaries[].name 必须含 `assets/` 前缀（用 assetBinaryPath 生成），
 * 且与对应 material.binary 一致，导入时按此键取回二进制。
 */
export function buildArticleExportZip(input: {
  article: ArticleExportMeta;
  contentMd: string;
  materials: ExportMaterialMeta[];
  binaries: { name: string; buffer: Buffer }[];
  includeMaterialsManifest?: boolean;
}): Buffer {
  const zip = new AdmZip();
  zip.addFile(ARTICLE_MD_FILE, Buffer.from(input.contentMd, "utf8"));

  const meta: ArticleMeta = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    app: "InkPress",
    exportedAt: new Date().toISOString(),
    title: input.article.title ?? "",
    digest: input.article.digest ?? "",
    status: input.article.status ?? "draft",
    ...(input.article.profileId ? { profileId: input.article.profileId } : {}),
    ...(input.article.themeId ? { themeId: input.article.themeId } : {}),
    ...(input.article.coverUrl ? { coverUrl: input.article.coverUrl } : {}),
    ...(input.article.createdAt
      ? { createdAt: toIso(input.article.createdAt) }
      : {}),
  };
  zip.addFile(
    ARTICLE_META_FILE,
    Buffer.from(JSON.stringify(meta, null, 2), "utf8")
  );

  if (input.includeMaterialsManifest !== false) {
    const manifest = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      items: input.materials,
    };
    zip.addFile(
      MATERIALS_FILE,
      Buffer.from(JSON.stringify(manifest, null, 2), "utf8")
    );
  }

  for (const b of input.binaries) {
    zip.addFile(b.name, b.buffer);
  }
  return zip.toBuffer();
}

function parseJsonBuffer(buf: Buffer, label: string): unknown {
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new Error(`${label} 不是合法的 JSON。`);
  }
}

export type ParsedArticleImport = {
  articleMeta: ArticleMeta;
  articleMd: string;
  materials: MaterialItem[];
  /** key = "assets/<name>" → 二进制 */
  binaries: Map<string, Buffer>;
};

/**
 * 校验单个解压条目路径的安全性。返回错误消息（不合法时）或 null（合法）。
 * 镜像 extractSkillFromZip 的防御：拒绝空字节 / 绝对路径 / 路径穿越（..）。
 * 抽成纯函数便于单测（adm-zip 的 writer 会净化 `..` / 绝对路径，无法用 addFile 构造恶意样例）。
 */
export function entryPathError(rawEntryName: string): string | null {
  if (rawEntryName.includes("\0")) {
    return `检测到非法路径（含空字节）：${rawEntryName}`;
  }
  if (/^[A-Za-z]:[\\/]/.test(rawEntryName) || rawEntryName.startsWith("/")) {
    return `检测到绝对路径，已拒绝：${rawEntryName}`;
  }
  const norm = rawEntryName.replace(/\\/g, "/");
  if (norm.split("/").some((seg) => seg === "..")) {
    return `检测到路径穿越（..），已拒绝：${rawEntryName}`;
  }
  return null;
}

/**
 * 解析导入 ZIP。白名单只接受 article.md / article.json / materials.json / assets/<单文件>。
 * 安全校验镜像 extractSkillFromZip：拒绝空字节 / 绝对路径 / `..`，跳过 __MACOSX / .DS_Store / 隐藏文件，
 * 单条 50MB、总 200MB 上限。缺 article.md 或 article.json 抛错。
 */
export function parseArticleImportZip(buffer: Buffer): ParsedArticleImport {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error("无法解析压缩包，请确认是有效的 .zip 文件。");
  }

  const entries = zip.getEntries();
  if (entries.length === 0) throw new Error("压缩包为空。");

  const binaries = new Map<string, Buffer>();
  let articleMdBuf: Buffer | null = null;
  let articleMetaBuf: Buffer | null = null;
  let materialsBuf: Buffer | null = null;
  let totalBytes = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const raw = entry.entryName;
    const pathErr = entryPathError(raw);
    if (pathErr) throw new Error(pathErr);
    const norm = raw.replace(/\\/g, "/");
    const segs = norm.split("/");
    if (segs.some((s) => s === "__MACOSX")) continue;
    const baseName = segs[segs.length - 1];
    if (baseName === ".DS_Store" || baseName.startsWith(".")) continue;

    const declaredSize =
      typeof entry.header?.size === "number" ? entry.header.size : undefined;
    if (declaredSize !== undefined && declaredSize > MAX_ENTRY_BYTES) {
      throw new Error(
        `文件过大（>${MAX_ENTRY_BYTES / 1024 / 1024}MB）：${raw}`
      );
    }
    if (declaredSize !== undefined) {
      totalBytes += declaredSize;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(
          `解压后总体积超过 ${MAX_TOTAL_BYTES / 1024 / 1024}MB 限制。`
        );
      }
    }

    const content = Buffer.from(entry.getData());
    if (content.byteLength > MAX_ENTRY_BYTES) {
      throw new Error(
        `文件过大（>${MAX_ENTRY_BYTES / 1024 / 1024}MB）：${raw}`
      );
    }
    if (declaredSize === undefined) {
      totalBytes += content.byteLength;
    }
    if (declaredSize === undefined && totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(
        `解压后总体积超过 ${MAX_TOTAL_BYTES / 1024 / 1024}MB 限制。`
      );
    }

    // 白名单分发
    if (norm === ARTICLE_MD_FILE) {
      articleMdBuf = content;
    } else if (norm === ARTICLE_META_FILE) {
      articleMetaBuf = content;
    } else if (norm === MATERIALS_FILE) {
      materialsBuf = content;
    } else if (norm.startsWith(`${ASSETS_DIR}/`) && segs.length === 2) {
      // 仅接受 assets/<单文件>，拒绝 assets/ 下再嵌套子目录
      binaries.set(norm, content);
    }
    // 其它未知文件：忽略（容错）
  }

  if (!articleMdBuf) throw new Error("压缩包缺少 article.md。");
  if (!articleMetaBuf) throw new Error("压缩包缺少 article.json。");

  const metaParse = articleMetaSchema.safeParse(
    parseJsonBuffer(articleMetaBuf, "article.json")
  );
  if (!metaParse.success) {
    throw new Error("article.json 格式不合法。");
  }

  let materials: MaterialItem[] = [];
  if (materialsBuf) {
    const mParse = materialsManifestSchema.safeParse(
      parseJsonBuffer(materialsBuf, "materials.json")
    );
    if (mParse.success) materials = mParse.data.items ?? [];
  }
  for (const m of materials) {
    if (!m.binary) continue;
    const binErr = entryPathError(m.binary);
    if (binErr || !ASSET_ENTRY_RE.test(m.binary)) {
      throw new Error(`materials.json 中包含非法素材路径：${m.binary}`);
    }
    if (!binaries.has(m.binary)) {
      throw new Error(`压缩包缺少素材二进制：${m.binary}`);
    }
  }

  return {
    articleMeta: metaParse.data,
    articleMd: articleMdBuf.toString("utf8"),
    materials,
    binaries,
  };
}

/**
 * 把正文里的旧素材 URL 改写为新 URL（导入本地素材重传后用）。
 * 用 split/join 做字面量替换，避免 URL 里的 ?() 等字符被当正则元字符。
 * 未在 urlMap 里的 URL 原样保留（如云素材 URL、外部图床）。
 */
export function rewriteImageLinks(
  md: string,
  urlMap: Map<string, string>
): string {
  if (urlMap.size === 0) return md;
  let out = md;
  for (const [oldUrl, newUrl] of urlMap) {
    if (!oldUrl || oldUrl === newUrl) continue;
    out = out.split(oldUrl).join(newUrl);
  }
  return out;
}

/** 提取正文里引用的本地存储对象 id（/api/storage/<id>），供导出路由并集查询素材。 */
const STORAGE_URL_RE = /\/api\/storage\/([A-Za-z0-9_-]+)/g;
export function collectLocalStorageIdsFromMd(md: string): string[] {
  const ids = new Set<string>();
  for (const m of md.matchAll(STORAGE_URL_RE)) {
    if (m[1]) ids.add(m[1]);
  }
  return [...ids];
}

// ────────────────────────────────────────────────────────────────────────────
// 单 Markdown 导入支持：元数据派生 + 媒体引用提取 + 文件类型判定。
//
// 纯函数（无 I/O），便于单测。服务层负责把它们的结果落库。
// ────────────────────────────────────────────────────────────────────────────

const TITLE_FALLBACK = "导入的文章";
const TITLE_MAX = 200;
const DIGEST_MAX = 120;

/** 剥离行内 markdown 符号（链接 → 文本、强调/标题标记），用于标题候选清洗。 */
function stripMarkdownInline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~>#]/g, "")
    .trim();
}

function firstH1(body: string): string {
  const m = body.match(/^#{1}\s+(.+?)\s*$/m);
  return m ? stripMarkdownInline(m[1]) : "";
}

function firstNonEmptyLine(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const stripped = stripMarkdownInline(line);
    if (stripped) return stripped;
  }
  return "";
}

/** 与 content-store.previewSnippetAt 一致的启发式：剥 markdown 符号 + 折叠空白 + 截断。 */
function bodySnippet(body: string, max = DIGEST_MAX): string {
  return body
    .replace(/[#*`>\-\[\]()!]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * 从单篇 Markdown 派生文章元数据。
 * - 标题：front-matter.title → 首条 H1 → 首个非空行 → 兜底「导入的文章」。
 * - 摘要：front-matter.description/digest/summary → 否则正文片段。
 * - body：剥掉 front-matter 后的正文；**body.trim()==="" 即视为空文件**（由调用方拒绝）。
 */
export function deriveArticleFromMarkdown(md: string): {
  title: string;
  digest: string;
  body: string;
} {
  const raw = md ?? "";
  let body = raw;
  let attrs: {
    title?: string;
    description?: string;
    digest?: string;
    summary?: string;
  } = {};
  try {
    const fm = matter<typeof attrs>(raw);
    body = fm.body || raw;
    attrs = fm.attributes ?? {};
  } catch {
    // front-matter 解析失败（畸形 YAML）→ 整篇当正文
  }

  const candidates = [
    typeof attrs.title === "string" ? attrs.title.trim() : "",
    firstH1(body),
    firstNonEmptyLine(body),
  ];
  let title = candidates.find((c) => c.length > 0) ?? "";
  title = title.slice(0, TITLE_MAX);
  if (!title || !TITLE_REGEX.test(title)) title = TITLE_FALLBACK;

  const descRaw =
    [attrs.description, attrs.digest, attrs.summary].find(
      (v): v is string => typeof v === "string" && v.trim().length > 0
    ) ?? "";
  const digest = (descRaw ? descRaw.trim() : bodySnippet(body)).slice(0, DIGEST_MAX);

  return { title, digest, body };
}

// ── 媒体引用提取 ──

export type MediaRef = {
  url: string;
  kind: "image" | "video" | "audio" | "file";
  contentType: string;
  name: string;
};

/** 扩展名 → {kind, mime}。未知扩展名不在表内（按上下文 kindHint 兜底）。 */
const EXT_MEDIA: Record<string, { kind: MediaRef["kind"]; mime: string }> = {
  png: { kind: "image", mime: "image/png" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  gif: { kind: "image", mime: "image/gif" },
  webp: { kind: "image", mime: "image/webp" },
  svg: { kind: "image", mime: "image/svg+xml" },
  bmp: { kind: "image", mime: "image/bmp" },
  ico: { kind: "image", mime: "image/x-icon" },
  mp4: { kind: "video", mime: "video/mp4" },
  webm: { kind: "video", mime: "video/webm" },
  mov: { kind: "video", mime: "video/quicktime" },
  avi: { kind: "video", mime: "video/x-msvideo" },
  m4v: { kind: "video", mime: "video/x-m4v" },
  mp3: { kind: "audio", mime: "audio/mpeg" },
  wav: { kind: "audio", mime: "audio/wav" },
  ogg: { kind: "audio", mime: "audio/ogg" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  flac: { kind: "audio", mime: "audio/flac" },
  pdf: { kind: "file", mime: "application/pdf" },
  doc: { kind: "file", mime: "application/msword" },
  docx: { kind: "file", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xls: { kind: "file", mime: "application/vnd.ms-excel" },
  xlsx: { kind: "file", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ppt: { kind: "file", mime: "application/vnd.ms-powerpoint" },
  pptx: { kind: "file", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  zip: { kind: "file", mime: "application/zip" },
};

function urlBasename(url: string): string {
  const noHash = url.split("#")[0];
  const noQuery = noHash.split("?")[0];
  const segs = noQuery.split("/").filter(Boolean);
  const last = segs[segs.length - 1];
  if (last) {
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
  return "file";
}

function extOf(url: string): string {
  const base = urlBasename(url);
  const idx = base.lastIndexOf(".");
  if (idx < 0) return "";
  return base.slice(idx + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * 从 Markdown 正文提取远程媒体引用（仅 http(s)，按 url 去重，首次出现者胜）。
 * 覆盖：markdown 图片、`<img>`、`<video>/<audio>` 的 src、`<source>`（按 type 区分音视频）、
 * 以及指向媒体扩展的 markdown 链接。非 http（如 /api/storage/...）不入列（外部 MD 无对应二进制）。
 */
export function extractMediaFromMarkdown(md: string): MediaRef[] {
  const found = new Map<string, MediaRef>();
  const push = (rawUrl: string, kindHint?: MediaRef["kind"]) => {
    const url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url) || found.has(url)) return;
    const cls = EXT_MEDIA[extOf(url)];
    const kind = cls?.kind ?? kindHint ?? "file";
    const contentType = cls?.mime ?? "";
    found.set(url, { url, kind, contentType, name: urlBasename(url) });
  };

  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    if (m[1]) push(m[1], "image");
  }
  for (const m of md.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    if (m[1]) push(m[1], "image");
  }
  for (const m of md.matchAll(/<video\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    if (m[1]) push(m[1], "video");
  }
  for (const m of md.matchAll(/<audio\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    if (m[1]) push(m[1], "audio");
  }
  // <source src type=...>：按 type 区分音视频，缺省按 video
  for (const m of md.matchAll(/<source\b([^>]*)>/gi)) {
    const attrs = m[1] ?? "";
    const srcM = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcM?.[1]) continue;
    const typeM = attrs.match(/\btype=["']([^"']+)["']/i);
    const type = typeM?.[1] ?? "";
    const hint: MediaRef["kind"] = type.startsWith("audio")
      ? "audio"
      : type.startsWith("video")
        ? "video"
        : "video";
    push(srcM[1], hint);
  }
  // 指向媒体扩展的 markdown 链接 [text](url)
  for (const m of md.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = m[1]?.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (EXT_MEDIA[extOf(url)]) push(url);
  }

  return [...found.values()];
}

/**
 * 判定导入文件类型：magic bytes 优先（避免 .md 命名的 zip 误判），其次扩展名/content-type。
 * 返回 "zip" | "md" | null（null = 不支持）。
 */
export function detectImportKind(input: {
  name: string;
  contentType?: string;
  bytes: Buffer;
}): "zip" | "md" | null {
  const { bytes, name, contentType } = input;
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return "zip";
  }
  const lower = name.toLowerCase();
  const ct = (contentType ?? "").toLowerCase();
  if (
    /\.(md|markdown|mdown)$/.test(lower) ||
    ct === "text/markdown" ||
    ct === "text/x-markdown"
  ) {
    return "md";
  }
  return null;
}
