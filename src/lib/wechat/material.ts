import { wxUpload, ensureOk, type WxResponse } from "./client";
import { prisma } from "@/lib/db";
import { createHash } from "node:crypto";

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

  // 缓存命中
  const cached = await prisma.material.findUnique({ where: { sourceHash: hash } });
  if (cached?.wxUrl) return cached.wxUrl;

  // 下载并上传
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
  return url;
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
    return { mediaId: cached.wxMediaId, url: cached.wxUrl };
  }

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
  return { mediaId: result.media_id, url: result.url ?? "" };
}

export type { WxResponse };
