import { prisma } from "@/lib/db";
import { deleteContent } from "@/lib/content-store";
import { deleteFromOss } from "@/lib/oss";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("recycle");

/** 彻底删除一篇文章：删正文文件 + 关联素材(OSS+DB) + DB 行 */
export async function purgeArticle(id: string) {
  await deleteContent(id).catch(() => {});
  // 先清理其关联素材（OSS 对象 + DB 行），解除外键依赖
  const assets = await prisma.asset.findMany({
    where: { articleId: id },
    select: { id: true, ossKey: true },
  });
  for (const a of assets) {
    await deleteFromOss(a.ossKey).catch((e) =>
      log.warn({ ossKey: a.ossKey, err: e }, "OSS 删除失败")
    );
  }
  if (assets.length) {
    await prisma.asset.deleteMany({ where: { articleId: id } });
  }
  await prisma.article.delete({ where: { id } });
}

/** 彻底删除一个空间：清理空间级素材(OSS+DB) + DB 行 */
export async function purgeSpace(id: string) {
  // 空间级素材（不绑文章的）解除外键依赖
  const assets = await prisma.asset.findMany({
    where: { spaceId: id, articleId: null },
    select: { id: true, ossKey: true },
  });
  for (const a of assets) {
    await deleteFromOss(a.ossKey).catch((e) =>
      log.warn({ ossKey: a.ossKey, err: e }, "OSS 删除失败")
    );
  }
  if (assets.length) {
    await prisma.asset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } });
  }
  await prisma.space.delete({ where: { id } });
}

/** 彻底删除一个素材：删 OSS 对象 + DB 行 */
export async function purgeAsset(id: string) {
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) return;
  await deleteFromOss(asset.ossKey).catch((e) => {
    log.warn({ ossKey: asset.ossKey, err: e }, "OSS 删除失败");
  });
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
