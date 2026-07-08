"use client";

import { useState, useEffect } from "react";
import { SnippetCreateBar } from "./SnippetCreateBar";
import { SnippetList } from "./SnippetList";
import { SnippetTagSidebar } from "./SnippetTagSidebar";
import { snippetMatchesAllTags } from "@/lib/snippets/tag-filter";
import { isValidTagColor } from "@/lib/snippets/tag-colors";
import type { SnippetItem } from "./types";

type TagEntry = { name: string; count: number; color: string | null };

interface SnippetsViewProps {
  initialSnippets: SnippetItem[];
  tags: TagEntry[];
  totalCount: number;
}

function parseTags(json: string): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function sortByCount(a: TagEntry, b: TagEntry): number {
  return b.count - a.count || a.name.localeCompare(b.name);
}

export function SnippetsView({
  initialSnippets,
  tags: initialTags,
  totalCount,
}: SnippetsViewProps) {
  const [snippets, setSnippets] = useState<SnippetItem[]>(initialSnippets);
  const [tags, setTags] = useState<TagEntry[]>(initialTags);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SnippetItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [colorMsg, setColorMsg] = useState<string | null>(null);

  // 派生 tagColors map（仅有效色），下传给卡片 pill 着色
  const tagColors: Record<string, string> = {};
  for (const t of tags) {
    if (isValidTagColor(t.color)) tagColors[t.name] = t.color;
  }

  // 搜索框非空时用 API 结果；否则用本地集合
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
    if (!snippetMatchesAllTags(parseTags(s.tagsJson), activeTags)) return false;
    if (activeKind && s.kind !== activeKind) return false;
    return true;
  });

  const handleToggleTag = (name: string) => {
    setActiveTags((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );
  };

  const handleSetTagColor = async (name: string, color: string | null) => {
    const snapshot = tags;
    // 乐观本地更新
    setTags((cur) => cur.map((t) => (t.name === name ? { ...t, color } : t)));
    try {
      const res = await fetch("/api/snippets/tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      });
      if (!res.ok) throw new Error("save color failed");
      const { tagColors: fresh } = (await res.json()) as {
        tagColors: Record<string, string>;
      };
      // 以服务端全量为准确算（并发安全：最后写入胜出）
      setTags((cur) =>
        cur.map((t) => ({ ...t, color: fresh[t.name] ?? null }))
      );
    } catch {
      setTags(snapshot); // 回滚
      setColorMsg("颜色保存失败");
      window.setTimeout(() => setColorMsg(null), 2000);
    }
  };

  const handleCreated = (snippet: SnippetItem) => {
    setSnippets((prev) => [snippet, ...prev]);
    const newTags = parseTags(snippet.tagsJson);
    if (newTags.length === 0) return;
    setTags((cur) => {
      const map = new Map(cur.map((t) => [t.name, { ...t }]));
      for (const nt of newTags) {
        const ex = map.get(nt);
        if (ex) ex.count += 1;
        else map.set(nt, { name: nt, count: 1, color: null });
      }
      return Array.from(map.values()).sort(sortByCount);
    });
  };

  const handleDeleted = (id: string) => {
    const removed = snippets.find((s) => s.id === id);
    setSnippets((prev) => prev.filter((s) => s.id !== id));
    if (!removed) return;
    const delTags = parseTags(removed.tagsJson);
    if (delTags.length === 0) return;
    setTags((cur) =>
      cur
        .map((t) => (delTags.includes(t.name) ? { ...t, count: t.count - 1 } : t))
        .filter((t) => t.count > 0)
        .sort(sortByCount)
    );
  };

  const handleUpdated = (updated: SnippetItem) => {
    setSnippets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
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
      <SnippetCreateBar
        onCreated={handleCreated}
        existingTags={tags.map((t) => t.name)}
      />

      {/* 主内容区 */}
      <div className="flex gap-6">
        {/* 标签侧栏 */}
        {tags.length > 0 && (
          <SnippetTagSidebar
            tags={tags}
            activeTags={activeTags}
            onToggleTag={handleToggleTag}
            onSetTagColor={handleSetTagColor}
          />
        )}

        {/* 瀑布流列表 */}
        <div className="flex-1 min-w-0">
          {colorMsg && (
            <p className="text-xs text-destructive mb-2">{colorMsg}</p>
          )}
          <SnippetList
            snippets={filteredSnippets}
            tagColors={tagColors}
            existingTags={tags.map((t) => t.name)}
            onDeleted={handleDeleted}
            onUpdated={handleUpdated}
          />
        </div>
      </div>
    </div>
  );
}
