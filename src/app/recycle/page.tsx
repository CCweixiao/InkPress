import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { RecycleBin } from "@/components/recycle/RecycleBin";

export const dynamic = "force-dynamic";

export default async function RecyclePage() {
  const [articles, spaces, assets, snippets] = await Promise.all([
    prisma.article.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: {
        id: true,
        title: true,
        spaceId: true,
        status: true,
        trashedAt: true,
        expiresAt: true,
      },
    }),
    prisma.space.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: { id: true, name: true, trashedAt: true, expiresAt: true },
    }),
    prisma.asset.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: {
        id: true,
        name: true,
        kind: true,
        url: true,
        trashedAt: true,
        expiresAt: true,
      },
    }),
    prisma.snippet.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: { id: true, title: true, content: true, kind: true, trashedAt: true, expiresAt: true },
    }),
  ]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-4xl px-6 h-14 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <div className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-primary" />
            <span className="font-semibold">回收站</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <RecycleBin
          articles={JSON.parse(JSON.stringify(articles))}
          spaces={JSON.parse(JSON.stringify(spaces))}
          assets={JSON.parse(JSON.stringify(assets))}
          snippets={JSON.parse(JSON.stringify(snippets))}
        />
      </main>
    </div>
  );
}
