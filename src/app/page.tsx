import { prisma } from "@/lib/db";
import { getUiPreferences } from "@/lib/ui-preferences";
import { previewSnippetAt } from "@/lib/content-store";
import { HomeView } from "@/components/spaces/HomeView";
import { BackToTop } from "@/components/common/BackToTop";
import { WorkspaceHeader } from "@/components/navigation/WorkspaceHeader";
import type { ArticleListItem } from "@/components/articles/ArticleCard";
import type { SpaceItem } from "@/components/spaces/SpaceSection";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // SSR 读回 UI 偏好（网格/列表）作为首帧值，避免闪烁
  const uiPreferences = await getUiPreferences();
  // 取空间 + 文章（含封面 Asset URL）
  const [spaces, articles, coverAssets] = await Promise.all([
    prisma.space.findMany({
      where: { trashed: false },
      include: { _count: { select: { articles: { where: { trashed: false } } } } },
    }),
    prisma.article.findMany({
      where: { trashed: false },
      orderBy: { updatedAt: "desc" },
      include: { theme: { select: { name: true } } },
    }),
    prisma.asset.findMany({
      where: { trashed: false },
      select: { id: true, url: true },
    }),
  ]);
  // 排序：默认空间 > 置顶 > createdAt 倒序（boolean orderBy 在 SQLite 不可靠，应用层排序）
  spaces.sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      Number(b.pinned) - Number(a.pinned) ||
      b.createdAt.getTime() - a.createdAt.getTime()
  );
  const coverMap = new Map(coverAssets.map((a) => [a.id, a.url]));

  // 构造文章列表项（摘要从文件读，避免列表页加载全文）
  const items: (ArticleListItem & { spaceId: string | null })[] =
    await Promise.all(
      articles.map(async (a) => ({
        id: a.id,
        title: a.title,
        contentMd: a.contentPath
          ? await previewSnippetAt(a.contentPath)
          : (a.contentMd ?? ""),
        digest: a.digest,
        status: a.status,
        theme: a.theme,
        coverUrl: a.coverUrl ?? (a.coverAssetId ? coverMap.get(a.coverAssetId) ?? null : null),
        updatedAt: a.updatedAt.toISOString(),
        spaceId: a.spaceId,
      }))
    );

  // 按空间分组
  const grouped = spaces.map((space) => ({
    space: space as unknown as SpaceItem,
    articles: items.filter((a) => a.spaceId === space.id),
  }));
  const unclassified = items.filter((a) => a.spaceId === null);

  return (
    <div className="min-h-screen">
      <WorkspaceHeader />

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        <HomeView
          spaces={grouped}
          unclassified={unclassified}
          initialViewMode={uiPreferences.viewMode}
        />
      </main>

      {/* 回到顶部 */}
      <BackToTop />
    </div>
  );
}
