import { prisma } from "@/lib/db";
import { deleteContent } from "@/lib/content-store";
import { deleteFromOss } from "@/lib/oss";
import { deleteWxMaterial } from "@/lib/wechat/material";
import { createHash } from "node:crypto";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("recycle");

/** sha1(url)：与 material.ts 的 hashUrl 对齐，用于反查 Material 缓存行 */
function hashUrl(url: string): string {
  return createHash("sha1").update(url).digest("hex");
}

/**
 * 清理单个素材的所有外部资源（OSS 对象 + 微信永久素材 + Material 渲染缓存）。
 * 三处 purge（素材/文章/空间）共用。失败只记 warn 不阻断，保证 DB 行始终能删。
 */
async function purgeAssetResources(asset: {
  id: string;
  ossKey: string;
  url: string;
  wxMediaId: string | null;
}): Promise<void> {
  // 1. 删 OSS 对象
  await deleteFromOss(asset.ossKey).catch((e) => {
    log.warn({ ossKey: asset.ossKey, err: e }, "OSS 删除失败");
  });

  // 2. 删微信永久素材（仅 add_material 产生的 media_id；uploadimg 正文图无 media_id 无需删）
  if (asset.wxMediaId) {
    try {
      await deleteWxMaterial(asset.wxMediaId);
      log.info({ mediaId: asset.wxMediaId }, "已删除微信永久素材");
    } catch (e) {
      log.warn({ mediaId: asset.wxMediaId, err: e }, "微信永久素材删除失败（不阻断）");
    }
  }

  // 3. 清理 Material 渲染缓存（让该图在后续渲染中视为未上传，避免脏缓存）
  await prisma.material
    .delete({ where: { sourceHash: hashUrl(asset.url) } })
    .catch(() => {});
}

/** 彻底删除一篇文章：删正文文件 + 关联素材(OSS+微信+DB) + DB 行 */
export async function purgeArticle(id: string) {
  await deleteContent(id).catch(() => {});
  // 先清理其关联素材（外部资源 + DB 行），解除外键依赖
  const assets = await prisma.asset.findMany({
    where: { articleId: id },
    select: { id: true, ossKey: true, url: true, wxMediaId: true },
  });
  for (const a of assets) {
    await purgeAssetResources(a);
  }
  if (assets.length) {
    await prisma.asset.deleteMany({ where: { articleId: id } });
  }
  await prisma.article.delete({ where: { id } });
}

/** 彻底删除一个空间：清理空间级素材(OSS+微信+DB) + DB 行 */
export async function purgeSpace(id: string) {
  // 空间级素材（不绑文章的）解除外键依赖
  const assets = await prisma.asset.findMany({
    where: { spaceId: id, articleId: null },
    select: { id: true, ossKey: true, url: true, wxMediaId: true },
  });
  for (const a of assets) {
    await purgeAssetResources(a);
  }
  if (assets.length) {
    await prisma.asset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } });
  }
  await prisma.space.delete({ where: { id } });
}

/** 彻底删除一个素材：删 OSS 对象 + 微信永久素材 + Material 缓存 + DB 行 */
export async function purgeAsset(id: string) {
  const asset = await prisma.asset.findUnique({
    where: { id },
    select: { id: true, ossKey: true, url: true, wxMediaId: true },
  });
  if (!asset) return;
  await purgeAssetResources(asset);
  await prisma.asset.delete({ where: { id } });
}

/** 清理所有已过期项（expiresAt <= now）。返回各类型清理数量。 */
export async function cleanupExpired() {
  const now = new Date();
  const [expiredArticles, expiredSpaces, expiredAssets] = await Promise.all([
    prisma.article.findMany({
      where: { trashed: true, expiresAt: { lte: now } },
      select: { id: true },
    }),
    prisma.space.findMany({
      where: { trashed: true, expiresAt: { lte: now } },
      select: { id: true },
    }),
    prisma.asset.findMany({
      where: { trashed: true, expiresAt: { lte: now } },
      select: { id: true },
    }),
  ]);

  for (const a of expiredArticles) await purgeArticle(a.id);
  for (const s of expiredSpaces) await purgeSpace(s.id);
  for (const a of expiredAssets) await purgeAsset(a.id);

  return {
    articles: expiredArticles.length,
    spaces: expiredSpaces.length,
    assets: expiredAssets.length,
  };
}
