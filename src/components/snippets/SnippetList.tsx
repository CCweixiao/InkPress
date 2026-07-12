"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { SnippetCard } from "./SnippetCard";
import type { SnippetItem } from "./types";

interface SnippetListProps {
  snippets: SnippetItem[];
  tagColors: Record<string, string>;
  existingTags?: string[];
  onDeleted: (id: string) => void;
  onUpdated: (snippet: SnippetItem) => void;
  selectMode?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

export function SnippetList({
  snippets,
  tagColors,
  existingTags,
  onDeleted,
  onUpdated,
  selectMode,
  selectedIds,
  onToggleSelect,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: SnippetListProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasMore || !onLoadMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !loadingMore) onLoadMore();
      },
      { rootMargin: "360px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  if (snippets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-lg text-muted-foreground">
          记录你的第一个灵感片段 ✨
        </p>
        <p className="text-sm text-muted-foreground/60 mt-2">
          闪念会在这里沉淀成可复用的写作素材
        </p>
      </div>
    );
  }

  const dateGroups = snippets.reduce<{ date: string; items: SnippetItem[] }[]>(
    (groups, snippet) => {
      const date = new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "short",
      }).format(new Date(snippet.createdAt));
      const latest = groups.at(-1);
      if (latest?.date === date) latest.items.push(snippet);
      else groups.push({ date, items: [snippet] });
      return groups;
    },
    []
  );

  return (
    <div className="space-y-7">
      {dateGroups.map(({ date, items }) => (
        <section key={date} className="relative pl-7 sm:pl-10">
          <div className="absolute bottom-0 left-2 top-7 w-px bg-gradient-to-b from-primary/50 via-border to-transparent sm:left-3" />
          <div className="absolute left-0 top-1.5 h-4 w-4 rounded-full border-4 border-background bg-primary shadow-[0_0_0_1px_hsl(var(--primary)/.28)] sm:left-1" />
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{date}</h2>
            <span className="text-xs text-muted-foreground">{items.length} 条灵感</span>
          </div>
          <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
            {items.map((snippet) => (
              <div key={snippet.id} className="mb-4 break-inside-avoid">
                <SnippetCard
                  snippet={snippet}
                  tagColors={tagColors}
                  existingTags={existingTags}
                  onDeleted={onDeleted}
                  onUpdated={onUpdated}
                  selectMode={selectMode}
                  selected={selectedIds?.includes(snippet.id)}
                  onToggleSelect={onToggleSelect ? () => onToggleSelect(snippet.id) : undefined}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
      <div ref={loadMoreRef} className="flex h-12 items-center justify-center text-xs text-muted-foreground">
        {loadingMore ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />正在加载更多灵感…</> : hasMore ? "继续向下滑动，加载更多" : "已展示全部灵感"}
      </div>
    </div>
  );
}
