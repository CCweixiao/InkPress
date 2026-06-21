import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { previewSnippet } from "@/lib/content-store";
import { NewArticleButton } from "@/components/articles/NewArticleButton";
import { SpaceDetail } from "@/components/spaces/SpaceDetail";
import type { ArticleListItem } from "@/components/articles/ArticleCard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export default async function SpaceDetailPage({ params }: Params) {
  const { id } = await params;
  const space = await prisma.space.findUnique({ where: { id } });
  if (!space || space.trashed) notFound();

  const [articles, coverAssets] = await Promise.all([
    prisma.article.findMany({
      where: { spaceId: id, trashed: false },
      orderBy: { updatedAt: "desc" },
      include: { theme: { select: { name: true } } },
    }),
    prisma.asset.findMany({
      where: { trashed: false },
      select: { id: true, url: true },
    }),
  ]);
  const coverMap = new Map(coverAssets.map((a) => [a.id, a.url]));

  const items: ArticleListItem[] = await Promise.all(
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
    }))
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </Link>
            <span className="text-muted-foreground/40">/</span>
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
              我的空间
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
            <span className="font-semibold truncate">{space.name}</span>
          </div>
          <NewArticleButton spaceId={space.id} size="sm" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <SpaceDetail space={space} articles={items} />
      </main>
    </div>
  );
}
