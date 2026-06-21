import Link from "next/link";
import { Boxes, FileCode2, FolderOpen, Palette, Settings, Sparkles, Trash2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { previewSnippet } from "@/lib/content-store";
import { Button } from "@/components/ui/button";
import { HomeView } from "@/components/spaces/HomeView";
import { GlobalSearch } from "@/components/common/GlobalSearch";
import type { ArticleListItem } from "@/components/articles/ArticleCard";
import type { SpaceItem } from "@/components/spaces/SpaceSection";

export const dynamic = "force-dynamic";

export default async function HomePage() {
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
          ? await previewSnippet(a.id)
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
      {/* 顶栏 */}
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="font-semibold text-lg">InkPress</span>
            <span className="text-xs text-muted-foreground ml-1 hidden sm:inline">
              AI 公众号写作台
            </span>
          </div>
          {/* 全局搜索 */}
          <div className="flex-1 max-w-md">
            <GlobalSearch />
          </div>
          <nav className="flex items-center gap-1 shrink-0">
            <Button asChild variant="ghost" size="sm">
              <Link href="/technical-documents">
                <FileCode2 className="h-4 w-4" />
                技术文档
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/themes">
                <Palette className="h-4 w-4" />
                主题
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/materials">
                <FolderOpen className="h-4 w-4" />
                素材
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/skills">
                <Boxes className="h-4 w-4" />
                技能仓库
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/recycle">
                <Trash2 className="h-4 w-4" />
                回收站
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings">
                <Settings className="h-4 w-4" />
                设置
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        <HomeView spaces={grouped} unclassified={unclassified} />
      </main>
    </div>
  );
}
