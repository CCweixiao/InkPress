"use client";

import { useState, useEffect } from "react";
import { SnippetCreateBar } from "./SnippetCreateBar";
import { SnippetList } from "./SnippetList";
import { SnippetTagSidebar } from "./SnippetTagSidebar";
import type { SnippetItem } from "./types";

interface SnippetsViewProps {
  initialSnippets: SnippetItem[];
  tags: { name: string; count: number }[];
  totalCount: number;
}

export function SnippetsView({
  initialSnippets,
  tags,
  totalCount,
}: SnippetsViewProps) {
  const [snippets, setSnippets] = useState<SnippetItem[]>(initialSnippets);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SnippetItem[] | null>(null);
  const [searching, setSearching] = useState(false);

  // 搜索框非空时用 API 结果；否则用本地筛选（kind/tag 在已加载集合内）
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/snippets?q=${encodeURIComponent(q)}&limit=100`);
        const data = (await res.json()) as { snippets: SnippetItem[] };
        setSearchResults(data.snippets ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const baseList = searchResults ?? snippets;
  const filteredSnippets = baseList.filter((s) => {
    if (searchResults) return true; // 已按 q 服务端筛过
    if (activeTag) {
      const tags: string[] = JSON.parse(s.tagsJson || "[]");
      if (!tags.includes(activeTag)) return false;
    }
    if (activeKind && s.kind !== activeKind) return false;
    return true;
  });

  const handleCreated = (snippet: SnippetItem) => {
    setSnippets((prev) => [snippet, ...prev]);
  };

  const handleDeleted = (id: string) => {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  };

  const handleUpdated = (updated: SnippetItem) => {
    setSnippets((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s))
    );
  };

  return (
    <div className="space-y-6">
      {/* 类型筛选标签 */}
      <div className="flex items-center gap-2 flex-wrap">
        {(
          [
            { label: "全部", value: null },
            { label: "文字", value: "text" },
            { label: "图文", value: "image" },
            { label: "引用", value: "quote" },
            { label: "链接", value: "link" },
          ] as const
        ).map(({ label, value }) => (
          <button
            key={label}
            onClick={() => setActiveKind(value)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              activeKind === value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">
          共 {totalCount} 条灵感
        </span>
      </div>

      {/* 搜索框 */}
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索灵感（标题 / 正文 / 标签）…"
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {searching && (
          <span className="text-xs text-muted-foreground">搜索中…</span>
        )}
      </div>

      {/* 创建框 */}
      <SnippetCreateBar onCreated={handleCreated} />

      {/* 主内容区 */}
      <div className="flex gap-6">
        {/* 标签侧栏 */}
        {tags.length > 0 && (
          <SnippetTagSidebar
            tags={tags}
            activeTag={activeTag}
            onSelectTag={(tag) =>
              setActiveTag(tag === activeTag ? null : tag)
            }
          />
        )}

        {/* 瀑布流列表 */}
        <div className="flex-1 min-w-0">
          <SnippetList
            snippets={filteredSnippets}
            onDeleted={handleDeleted}
            onUpdated={handleUpdated}
          />
        </div>
      </div>
    </div>
  );
}
