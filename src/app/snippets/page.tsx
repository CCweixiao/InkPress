import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { prisma } from "@/lib/db";
import { SnippetsView } from "@/components/snippets/SnippetsView";

export const dynamic = "force-dynamic";

export default async function SnippetsPage() {
  const [snippets, allSnippets] = await Promise.all([
    prisma.snippet.findMany({
      where: { trashed: false },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 40,
    }),
    // 获取标签计数
    prisma.snippet.findMany({
      where: { trashed: false },
      select: { tagsJson: true },
    }),
  ]);

  // 统计标签
  const tagCounts = new Map<string, number>();
  for (const s of allSnippets) {
    try {
      const tags: string[] = JSON.parse(s.tagsJson);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    } catch {
      // skip
    }
  }
  const tags = Array.from(tagCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="font-semibold">灵感</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <SnippetsView
          initialSnippets={JSON.parse(JSON.stringify(snippets))}
          tags={tags}
          totalCount={allSnippets.length}
        />
      </main>
    </div>
  );
}
