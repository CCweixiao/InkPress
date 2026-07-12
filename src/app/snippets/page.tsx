import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { prisma } from "@/lib/db";
import { SnippetsView } from "@/components/snippets/SnippetsView";
import {
  serializeSnippet,
  withTagsInclude,
  countTagsByUsage,
} from "@/lib/snippets/tag-repo";
import { getTagColors } from "@/lib/snippets/tag-color-store";

export const dynamic = "force-dynamic";

export default async function SnippetsPage() {
  const [snippetPage, tagCounts, tagColors, totalCount] = await Promise.all([
    prisma.snippet.findMany({
      where: { trashed: false },
      // 灵感页以时间为主线，最新记录始终排在最前面。
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 11,
      include: withTagsInclude,
      omit: { embedding: true, tagsJson: true }, // 不把 KB 级向量/废弃 tagsJson 灌给前端
    }),
    countTagsByUsage(),
    getTagColors(),
    prisma.snippet.count({ where: { trashed: false } }),
  ]);

  const hasMore = snippetPage.length > 10;
  const snippets = hasMore ? snippetPage.slice(0, 10) : snippetPage;

  // 合并标签计数与颜色（计数已由 countTagsByUsage 在 DB 侧算好）
  const tagsWithColor = tagCounts.map((t) => ({
    ...t,
    color: tagColors[t.name] ?? null,
  }));

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center gap-3">
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

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <SnippetsView
          initialSnippets={JSON.parse(JSON.stringify(snippets.map(serializeSnippet)))}
          tags={tagsWithColor}
          totalCount={totalCount}
          initialNextCursor={hasMore ? snippets.at(-1)?.id ?? null : null}
        />
      </main>
    </div>
  );
}
