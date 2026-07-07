import { prisma } from "@/lib/db";
import { writeContentAt, articleFilePath, readContentAt } from "@/lib/content-store";
import { classifyByContentType } from "@/lib/oss";
import { genAssetName, tagsToJson, parseTags } from "@/lib/asset";
import { putBufferObject, readStorageObjectBuffer } from "@/lib/storage";
import { moduleLogger } from "@/lib/logger";
import { logMutation } from "@/lib/api-log";
import { TITLE_REGEX } from "@/lib/validation";
import { ARTICLE_TYPE_PROFILES } from "@/lib/ai/article-type-profile";
import {
  buildArticleExportZip,
  rewriteImageLinks,
  collectLocalStorageIdsFromMd,
  isCloudAssetUrl,
  assetBinaryPath,
  type ParsedArticleImport,
  type ArticleExportMeta,
  type ExportMaterialMeta,
} from "@/lib/article-portability";

// ────────────────────────────────────────────────────────────────────────────
// 文章导入/导出 服务层（DB + 存储 编排）。
//
// 纯转换逻辑（解析/派生/提取/打包）在 article-portability.ts；本模块只做副作用编排，
// 供 API 路由薄调用。zip 与 md 两条导入路径在此统一为 importOneArticle。
// ────────────────────────────────────────────────────────────────────────────

const log = moduleLogger("article.portability");
const ASSET_KINDS = new Set(["image", "video", "audio", "file"]);
export const MAX_EXPORT_ASSET_BYTES = 50 * 1024 * 1024;

export class ArticleExportTooLargeError extends Error {
  constructor(public readonly estimatedBytes: number) {
    super(
      `本地素材预计打包大小为 ${formatBytes(estimatedBytes)}，已超过 ${formatBytes(MAX_EXPORT_ASSET_BYTES)} 限制。请减少本地素材后再导出，或取消“打包素材”并单独备份素材资料。`
    );
    this.name = "ArticleExportTooLargeError";
  }
}

/** 统一素材输入：有 binary → 重传；无 binary 且有 url → 引用型。 */
export type AssetInput = {
  name?: string;
  kind?: string;
  contentType?: string;
  /** 原/远程 URL（引用型用；本地素材同时作为正文链接改写 key） */
  url?: string;
  ossKey?: string;
  size?: number;
  description?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  /** 有则 putBufferObject 重传，无则按引用型 Asset 落库 */
  binary?: Buffer;
};

export type ImportOneArticleInput = {
  spaceId: string | null;
  title?: string;
  digest?: string;
  contentMd: string;
  profileId?: string;
  themeId?: string;
  status?: string;
  coverUrl?: string;
  assets: AssetInput[];
};

// ── 元数据回落（迁移自原 import 路由） ──────────────────────────────────────

function resolveTitle(title: string | undefined): string {
  const t = (title ?? "").trim();
  if (t && TITLE_REGEX.test(t)) return t;
  return "导入的文章";
}

function resolveProfileId(profileId: string | undefined): string | null {
  if (
    profileId &&
    Object.prototype.hasOwnProperty.call(ARTICLE_TYPE_PROFILES, profileId)
  ) {
    return profileId;
  }
  return null;
}

function resolveAssetKind(
  kind: string | undefined,
  fallback: "image" | "video" | "audio" | "file"
): "image" | "video" | "audio" | "file" {
  return kind && ASSET_KINDS.has(kind)
    ? (kind as "image" | "video" | "audio" | "file")
    : fallback;
}

async function resolveThemeId(themeId: string | undefined): Promise<string | null> {
  if (themeId) {
    const exists = await prisma.theme.findUnique({ where: { id: themeId } });
    if (exists) return themeId;
  }
  const def =
    (await prisma.theme.findFirst({ where: { isDefault: true } })) ??
    (await prisma.theme.findFirst({ where: { isBuiltIn: true } }));
  return def?.id ?? null;
}

/** zip 解析结果 → 统一 AssetInput[]（把对应二进制 buffer 并回条目）。 */
export function materialsToAssetInputs(parsed: ParsedArticleImport): AssetInput[] {
  return parsed.materials.map((m) => ({
    name: m.name,
    kind: m.kind,
    contentType: m.contentType,
    url: m.url,
    ossKey: m.ossKey,
    size: m.size,
    description: m.description,
    tags: m.tags,
    metadata: m.metadata,
    binary: m.binary ? parsed.binaries.get(m.binary) : undefined,
  }));
}

/**
 * 按统一输入创建一篇文章 + 其素材 + 正文文件。
 * - 有 binary 的素材：重传到当前存储并把正文旧 URL 改写为新 URL。
 * - 仅 url 的素材：按原 URL 建引用型 Asset（storageObjectId=null）。
 * - 单条素材失败 try/catch 跳过 + 记日志，不中断。
 */
export async function importOneArticle(input: ImportOneArticleInput): Promise<{ id: string }> {
  const title = resolveTitle(input.title);
  const profileId = resolveProfileId(input.profileId);
  const themeId = await resolveThemeId(input.themeId);
  // status 只保留 draft/ready；pushed 需要 wx 同步链路，导入时回落 draft
  const status = input.status === "ready" ? "ready" : "draft";

  const article = await prisma.article.create({
    data: {
      title,
      digest: input.digest ?? null,
      status,
      profileId,
      themeId,
      spaceId: input.spaceId,
      coverUrl: input.coverUrl ?? null,
    },
  });
  const contentPath = articleFilePath({
    articleId: article.id,
    spaceId: input.spaceId,
  });

  const urlMap = new Map<string, string>();
  let importedCoverAssetId: string | null = null;
  let createdAssets = 0;
  for (const a of input.assets) {
    try {
      const contentType = a.contentType || "application/octet-stream";
      const tagsJson = tagsToJson(a.tags ?? []);
      const metadataJson = JSON.stringify(a.metadata ?? {});
      const description = a.description ?? "";

      if (a.binary) {
        const { kind, dir } = classifyByContentType(contentType);
        const filename = a.name || "asset";
        const storageObject = await putBufferObject({
          buffer: a.binary,
          filename,
          contentType,
          kind: dir,
          articleId: article.id,
          spaceId: input.spaceId,
          metadata: { ...(a.metadata ?? {}), imported: true },
          preferCloud: true,
        });
        const asset = await prisma.asset.create({
          data: {
            name: a.name || genAssetName(filename, contentType),
            ossKey: storageObject.key,
            url: storageObject.url ?? `/api/storage/${storageObject.id}`,
            kind,
            size: storageObject.size,
            contentType: storageObject.contentType,
            storageObjectId: storageObject.id,
            metadataJson: storageObject.metadataJson,
            description,
            tagsJson,
            articleId: article.id,
            spaceId: input.spaceId,
          },
        });
        if (a.url) urlMap.set(a.url, asset.url);
        if (input.coverUrl && a.url === input.coverUrl) {
          importedCoverAssetId = asset.id;
        }
        createdAssets += 1;
      } else if (a.url) {
        // 引用型：按原 URL 重建记录（云素材 / MD 提取的远程媒体）
        const { kind: classifiedKind } = classifyByContentType(contentType);
        const asset = await prisma.asset.create({
          data: {
            name: a.name || genAssetName(a.url, contentType),
            ossKey: a.ossKey || a.url,
            url: a.url,
            kind: resolveAssetKind(a.kind, classifiedKind),
            size: a.size ?? 0,
            contentType,
            storageObjectId: null,
            metadataJson,
            description,
            tagsJson,
            articleId: article.id,
            spaceId: input.spaceId,
          },
        });
        if (input.coverUrl && a.url === input.coverUrl) {
          importedCoverAssetId = asset.id;
        }
        createdAssets += 1;
      }
    } catch (err) {
      log.warn({ url: a.url, err }, "导入单条素材失败，跳过");
    }
  }

  const rewritten = rewriteImageLinks(input.contentMd, urlMap);
  const rewrittenCoverUrl =
    input.coverUrl && urlMap.has(input.coverUrl)
      ? urlMap.get(input.coverUrl)!
      : (input.coverUrl ?? null);
  await writeContentAt(contentPath, rewritten);
  await prisma.article.update({
    where: { id: article.id },
    data: { contentPath, coverUrl: rewrittenCoverUrl, coverAssetId: importedCoverAssetId },
  });

  logMutation("article", "import", {
    id: article.id,
    spaceId: input.spaceId,
    assets: createdAssets,
  });
  return { id: article.id };
}

// ── 导出 ──────────────────────────────────────────────────────────────────────

function parseMetadata(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function safeFileSegment(s: string, fallback: string): string {
  const cleaned = (s || "").replace(/[\\/:*?"<>|]/g, "-").trim();
  return cleaned || fallback;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)}MB`;
  }
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

/**
 * 打包一篇文章为导出 ZIP。返回 { zip, filename }；文章不存在返回 null（由路由映射 404）。
 * 素材 = 文章关联素材 ∪ 正文里引用到的本地存储素材（去重）；
 * 本地素材内嵌二进制，云素材仅元数据（与「仅记录引用」决策一致）。
 */
export async function exportArticleToZip(input: {
  articleId: string;
  /** 编辑器屏幕最新正文；缺省回落文件内容 */
  contentMd?: string;
  /** 是否导出素材元数据与本地素材二进制；默认导出。 */
  includeAssets?: boolean;
}): Promise<{ zip: Buffer; filename: string } | null> {
  const article = await prisma.article.findUnique({
    where: { id: input.articleId },
  });
  if (!article) return null;

  const contentMd =
    typeof input.contentMd === "string"
      ? input.contentMd
      : article.contentPath
        ? await readContentAt(article.contentPath)
        : (article.contentMd ?? "");

  const materials: ExportMaterialMeta[] = [];
  const binaries: { name: string; buffer: Buffer }[] = [];
  const includeAssets = input.includeAssets !== false;

  if (includeAssets) {
    const articleAssets = await prisma.asset.findMany({
      where: { articleId: input.articleId, trashed: false },
    });
    const mdStorageIds = collectLocalStorageIdsFromMd(contentMd);
    const mdAssets =
      mdStorageIds.length > 0
        ? await prisma.asset.findMany({
            where: { storageObjectId: { in: mdStorageIds }, trashed: false },
          })
        : [];
    const coverAsset =
      article.coverAssetId && !articleAssets.some((a) => a.id === article.coverAssetId)
        ? await prisma.asset.findFirst({
            where: { id: article.coverAssetId, trashed: false },
          })
        : null;
    const seen = new Set<string>();
    const assets = [...articleAssets, ...mdAssets, ...(coverAsset ? [coverAsset] : [])].filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });

    const estimatedLocalBytes = assets.reduce((sum, a) => {
      return !isCloudAssetUrl(a.url) && a.storageObjectId ? sum + Math.max(0, a.size) : sum;
    }, 0);
    if (estimatedLocalBytes > MAX_EXPORT_ASSET_BYTES) {
      throw new ArticleExportTooLargeError(estimatedLocalBytes);
    }

    for (const a of assets) {
      if (!isCloudAssetUrl(a.url) && a.storageObjectId) {
        try {
          const buf = await readStorageObjectBuffer(a.storageObjectId);
          const binPath = assetBinaryPath(a.id, a.name);
          binaries.push({ name: binPath, buffer: buf });
          materials.push({
            id: a.id,
            name: a.name,
            kind: a.kind,
            size: a.size,
            contentType: a.contentType,
            url: a.url,
            ossKey: a.ossKey,
            description: a.description,
            tags: parseTags(a.tagsJson),
            metadata: parseMetadata(a.metadataJson),
            binary: binPath,
          });
          continue;
        } catch (err) {
          log.warn({ assetId: a.id, err }, "读取本地素材二进制失败，降级为仅元数据");
        }
      }
      materials.push({
        id: a.id,
        name: a.name,
        kind: a.kind,
        size: a.size,
        contentType: a.contentType,
        url: a.url,
        ossKey: a.ossKey,
        description: a.description,
        tags: parseTags(a.tagsJson),
        metadata: parseMetadata(a.metadataJson),
      });
    }
  }

  const meta: ArticleExportMeta = {
    title: article.title,
    digest: article.digest,
    status: article.status,
    profileId: article.profileId,
    themeId: article.themeId,
    coverUrl: article.coverUrl,
    createdAt: article.createdAt,
  };
  const zip = buildArticleExportZip({
    article: meta,
    contentMd,
    materials,
    binaries,
    includeMaterialsManifest: includeAssets,
  });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${safeFileSegment(article.title, "article")}-${date}.zip`;
  logMutation("article", "export", {
    id: article.id,
    assets: materials.length,
    includeAssets,
  });
  return { zip, filename };
}
