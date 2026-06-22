import { wxUpload, wxJson, ensureOk, type WxResponse } from "./client";
import { prisma } from "@/lib/db";
import { createHash } from "node:crypto";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("wechat.material");

export type UploadedMaterial = {
  url: string; // 正文图用
  mediaId?: string; // 封面用（add_material 才返回）
};

/** sha1 哈希外链 URL，用于 Material 表去重 */
function hashUrl(url: string): string {
  return createHash("sha1").update(url).digest("hex");
}

/**
 * 上传正文图片（media/uploadimg）
 * 返回的 URL 用于文章 content HTML 内的 <img src>（公众号防盗链，外链图必须走此接口换 wx_src）
 * 带 Material 表去重缓存，同一图不重复上传。
 */
export async function uploadBodyImage(
  sourceUrl: string,
  fetcher: (url: string) => Promise<ArrayBuffer>
): Promise<string | null> {
  const hash = hashUrl(sourceUrl);

  // 一级缓存：Material 表
  const cached = await prisma.material.findUnique({ where: { sourceHash: hash } });
  if (cached?.wxUrl) {
    log.debug({ sourceHash: hash, cached: true }, "正文图命中缓存");
    return cached.wxUrl;
  }

  // 二级回退：素材库 Asset 表（已同步过公众号的图片直接复用，避免重复上传）
  const reused = await tryReuseAssetWxUrl(sourceUrl);
  if (reused) return reused;

  // 下载并上传
  const start = Date.now();
  const buf = await fetcher(sourceUrl);
  const blob = new Blob([buf]);
  const form = new FormData();
  form.append("media", blob, "image");
  const data = await wxUpload("/media/uploadimg", form);
  ensureOk(data, "上传正文图片");
  const url = (data as { url?: string }).url;
  if (!url) return null;

  await prisma.material.upsert({
    where: { sourceHash: hash },
    update: { wxUrl: url },
    create: { sourceUrl, sourceHash: hash, wxUrl: url, kind: "body" },
  });
  log.info(
    { sourceHash: hash, size: buf.byteLength, durationMs: Date.now() - start },
    "正文图上传完成"
  );
  return url;
}

/**
 * 素材库回退：按 OSS URL 反查 Asset 表，若该素材已成功同步过公众号，
 * 直接复用其 wxUrl，并把 wxUrl 回填到 Material 表（让后续渲染命中一级缓存）。
 * 命中返回 wxUrl，未命中返回 null。
 */
export async function tryReuseAssetWxUrl(sourceUrl: string): Promise<string | null> {
  const asset = await prisma.asset.findFirst({
    where: { url: sourceUrl, wxSyncStatus: "success" },
    select: { wxUrl: true },
  });
  if (!asset?.wxUrl) return null;

  // 回填 Material 一级缓存：同一张图后续渲染直接命中 Material，不再查 Asset
  const hash = hashUrl(sourceUrl);
  await prisma.material.upsert({
    where: { sourceHash: hash },
    update: { wxUrl: asset.wxUrl },
    create: { sourceUrl, sourceHash: hash, wxUrl: asset.wxUrl, kind: "body" },
  });
  log.info({ sourceUrl, sourceHash: hash }, "正文图复用素材库已同步的 wxUrl");
  return asset.wxUrl;
}

/**
 * 把已知的 (sourceUrl → wxUrl) 映射写入 Material 表缓存。
 * 用于素材同步成功后预填缓存，让后续文章渲染命中一级缓存、不重复上传。
 */
export async function backfillMaterialCache(
  sourceUrl: string,
  wxUrl: string
): Promise<void> {
  const hash = hashUrl(sourceUrl);
  await prisma.material.upsert({
    where: { sourceHash: hash },
    update: { wxUrl },
    create: { sourceUrl, sourceHash: hash, wxUrl, kind: "body" },
  });
}

/**
 * 删除微信永久素材（material/del_material）。
 * 仅对 add_material 产生的 media_id 有意义（视频/文件/封面永久素材）。
 * uploadimg 产生的正文图 URL 无 media_id、不占配额，无需删除。
 */
export async function deleteWxMaterial(mediaId: string): Promise<void> {
  const data = await wxJson("/material/del_material", { media_id: mediaId });
  ensureOk(data, "删除微信永久素材");
}

/**
 * 上传封面图（material/add_material，永久素材）
 * 返回 media_id，用于 draft/add 的 thumb_media_id
 */
export async function uploadCoverImage(
  sourceUrl: string,
  fetcher: (url: string) => Promise<ArrayBuffer>
): Promise<{ mediaId: string; url: string } | null> {
  const hash = `cover:${hashUrl(sourceUrl)}`;
  const cached = await prisma.material.findUnique({ where: { sourceHash: hash } });
  if (cached?.wxMediaId && cached.wxUrl) {
    log.debug({ sourceHash: hash, cached: true }, "封面图命中缓存");
    return { mediaId: cached.wxMediaId, url: cached.wxUrl };
  }

  const start = Date.now();
  const buf = await fetcher(sourceUrl);
  const blob = new Blob([buf]);
  const form = new FormData();
  form.append("media", blob, "cover.jpg");
  const data = await wxUpload("/material/add_material", form, { type: "image" });
  ensureOk(data, "上传封面图");
  const result = data as { media_id?: string; url?: string };
  if (!result.media_id) return null;

  await prisma.material.upsert({
    where: { sourceHash: hash },
    update: { wxMediaId: result.media_id, wxUrl: result.url ?? "" },
    create: {
      sourceUrl,
      sourceHash: hash,
      wxMediaId: result.media_id,
      wxUrl: result.url ?? "",
      kind: "cover",
    },
  });
  log.info(
    { mediaId: result.media_id, size: buf.byteLength, durationMs: Date.now() - start },
    "封面图上传完成"
  );
  return { mediaId: result.media_id, url: result.url ?? "" };
}

export type { WxResponse };
