"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  Search,
  Image as ImageIcon,
  Quote,
  Link as LinkIcon,
} from "lucide-react";
import { snippetToMarkdown } from "@/lib/ai/snippet-markdown";
import type { SnippetItem } from "@/components/snippets/types";

interface SnippetInsertPanelProps {
  onInsertMarkdown: (md: string) => void;
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === "image") return <ImageIcon className="h-3 w-3 text-muted-foreground" />;
  if (kind === "quote") return <Quote className="h-3 w-3 text-muted-foreground" />;
  if (kind === "link") return <LinkIcon className="h-3 w-3 text-muted-foreground" />;
  return null;
}

/** 把 SnippetItem（tagsJson 是字符串）转成 snippetToMarkdown 需要的形状。 */
function toMarkdown(s: SnippetItem): string {
  return snippetToMarkdown({
    kind: s.kind,
    content: s.content,
    title: s.title,
    imageUrl: s.imageUrl,
    quoteSource: s.quoteSource,
    linkUrl: s.linkUrl,
    linkTitle: s.linkTitle,
  });
}

/** 面板卡片 onDragStart 写的载荷（与 SnippetDrop 插件读的 mime 对齐）。 */
function toDragPayload(s: SnippetItem): string {
  return JSON.stringify({
    kind: s.kind,
    content: s.content,
    title: s.title,
    imageUrl: s.imageUrl,
    quoteSource: s.quoteSource,
    linkUrl: s.linkUrl,
    linkTitle: s.linkTitle,
  });
}

function parseTags(tagsJson: string): string[] {
  try {
    return JSON.parse(tagsJson || "[]");
  } catch {
    return [];
  }
}

export function SnippetInsertPanel({ onInsertMarkdown }: SnippetInsertPanelProps) {
  const [items, setItems] = useState<SnippetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SnippetItem[] | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/snippets?limit=100");
      const data = (await res.json().catch(() => ({}))) as { snippets?: SnippetItem[] };
      setItems(data.snippets ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/snippets?q=${encodeURIComponent(q)}&limit=100`);
        const data = (await res.json().catch(() => ({}))) as { snippets?: SnippetItem[] };
        setSearchResults(data.snippets ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const list = searchResults ?? items;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索灵感…"
          className="w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {loading && (
        <div className="py-4 text-center text-xs text-muted-foreground">加载中…</div>
      )}
      {!loading && error && (
        <div className="py-4 text-center text-xs text-muted-foreground">
          加载失败，
          <button type="button" className="text-primary underline" onClick={refresh}>
            重试
          </button>
        </div>
      )}
      {!loading && !error && list.length === 0 && (
        <div className="py-4 text-center text-xs text-muted-foreground">
          {query ? "未找到匹配的灵感" : "还没有灵感，去 /snippets 创建"}
        </div>
      )}
      {!loading &&
        !error &&
        list.map((s) => {
          const tags = parseTags(s.tagsJson);
          return (
            <div
              key={s.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("application/x-snippet", toDragPayload(s))}
              onClick={() => onInsertMarkdown(toMarkdown(s))}
              className="group cursor-pointer rounded-md border border-border bg-background p-2 transition-all hover:border-primary/40 hover:shadow-sm"
              title="点击插入到光标处，或拖拽到正文指定位置"
            >
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 shrink-0 text-primary" />
                <KindIcon kind={s.kind} />
                <span className="truncate text-xs font-medium">
                  {s.title || s.content.slice(0, 24)}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                {s.content}
              </p>
              {tags.length > 0 && (
                <span className="mt-0.5 block truncate text-[10px] text-primary/70">
                  #{tags[0]}
                </span>
              )}
            </div>
          );
        })}
      {searching && <div className="text-[10px] text-muted-foreground">搜索中…</div>}
    </div>
  );
}
