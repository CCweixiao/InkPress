import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { prisma } from "@/lib/db";
import { SnippetsView } from "@/components/snippets/SnippetsView";
import { collectUniqueTags } from "@/lib/snippets/tag-filter";
import { getTagColors } from "@/lib/snippets/tag-color-store";

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

  // 统计标签（去重 + 计数）+ 合并标签颜色
  const tags = collectUniqueTags(allSnippets);
  const tagColors = await getTagColors();
  const tagsWithColor = tags.map((t) => ({
    ...t,
    color: tagColors[t.name] ?? null,
  }));

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
          tags={tagsWithColor}
          totalCount={allSnippets.length}
        />
      </main>
    </div>
  );
}
