"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Pin, Trash2, Hash, Plus, Search } from "lucide-react";
import { SnippetList } from "./SnippetList";
import { SnippetTagSidebar } from "./SnippetTagSidebar";
import { snippetMatchesAllTags } from "@/lib/snippets/tag-filter";
import { isValidTagColor, resolveTagColor, getTagColorClasses } from "@/lib/snippets/tag-colors";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { BatchTagPicker } from "./BatchTagPicker";
import {
  resolvePinToggle,
  mergeTag,
  removeTag,
  diffTagSets,
  applyTagDeltas,
  type BatchAction,
} from "@/lib/snippets/batch-ops";
import type { SnippetItem } from "./types";

type TagEntry = { name: string; count: number; color: string | null };

interface SnippetsViewProps {
  initialSnippets: SnippetItem[];
  tags: TagEntry[];
  totalCount: number;
  initialNextCursor: string | null;
}

function sortByCount(a: TagEntry, b: TagEntry): number {
  return b.count - a.count || a.name.localeCompare(b.name);
}

export function SnippetsView({
  initialSnippets,
  tags: initialTags,
  totalCount,
  initialNextCursor,
}: SnippetsViewProps) {
  const router = useRouter();
  const [snippets, setSnippets] = useState<SnippetItem[]>(initialSnippets);
  const [tags, setTags] = useState<TagEntry[]>(initialTags);
  const [total, setTotal] = useState(totalCount);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SnippetItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [colorMsg, setColorMsg] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const openQuickDialog = () => {
    window.dispatchEvent(new Event("inkpress:open-snippet-quick-dialog"));
  };

  useEffect(() => {
    setSnippets(initialSnippets);
    setTags(initialTags);
    setTotal(totalCount);
    setNextCursor(initialNextCursor);
  }, [initialSnippets, initialTags, totalCount, initialNextCursor]);

  useEffect(() => {
    const onCreated = (event: Event) => {
      const snippet = (event as CustomEvent<SnippetItem>).detail;
      if (!snippet?.id) return;
      setSnippets((prev) => {
        if (prev.some((s) => s.id === snippet.id)) return prev;
        return [snippet, ...prev];
      });
      setTotal((prev) => prev + 1);
      const newTags = snippet.tags;
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
    window.addEventListener("inkpress:snippet-created", onCreated);
    return () => window.removeEventListener("inkpress:snippet-created", onCreated);
  }, []);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds([]);
  };

  // —— 选择模式批量操作派生 ——
  const selectedSet = new Set(selectedIds);
  const selectedSnippets = snippets.filter((s) => selectedSet.has(s.id));
  const pinToggle = resolvePinToggle(
    selectedSnippets.map((s) => ({ pinned: !!s.pinned }))
  );
  const removeCandidates = Array.from(
    new Set(selectedSnippets.flatMap((s) => s.tags))
  );

  const handleBatch = async (
    action: BatchAction,
    opts?: { pinned?: boolean; tag?: string }
  ) => {
    if (selectedIds.length === 0) return;

    // 删除二次确认
    if (action === "delete") {
      const ok = await confirm({
        title: `删除选中的 ${selectedIds.length} 条素材？`,
        description: "移入回收站，可找回。",
        variant: "destructive",
        confirmText: "删除",
      });
      if (!ok) return;
    }

    // 纯计算乐观结果（不在 setState updater 里搞副作用，避 StrictMode 双调）
    const target = opts?.pinned;
    const tag = opts?.tag ?? "";
    const deltas = new Map<string, number>();
    let nextSnippets = snippets;
    let nextTags = tags;

    if (action === "delete") {
      for (const s of selectedSnippets) {
        for (const t of s.tags) {
          deltas.set(t, (deltas.get(t) ?? 0) - 1);
        }
      }
      nextSnippets = snippets.filter((s) => !selectedSet.has(s.id));
      nextTags = applyTagDeltas(tags, deltas);
    } else if (action === "pin" && typeof target === "boolean") {
      nextSnippets = snippets.map((s) =>
        selectedSet.has(s.id) ? { ...s, pinned: target } : s
      );
    } else if (action === "addTag" || action === "removeTag") {
      nextSnippets = snippets.map((s) => {
        if (!selectedSet.has(s.id)) return s;
        const before = s.tags;
        const after =
          action === "addTag" ? mergeTag(before, tag) : removeTag(before, tag);
        const { added, removed } = diffTagSets(before, after);
        for (const t of added) deltas.set(t, (deltas.get(t) ?? 0) + 1);
        for (const t of removed) deltas.set(t, (deltas.get(t) ?? 0) - 1);
        return { ...s, tags: after };
      });
      nextTags = applyTagDeltas(tags, deltas);
    }

    // 乐观落地 + 退出选择
    setSnippets(nextSnippets);
    if (action === "delete") {
      setSearchResults((prev) => prev?.filter((s) => !selectedSet.has(s.id)) ?? null);
      setTotal((prev) => Math.max(0, prev - selectedIds.length));
    }
    if (nextTags !== tags) setTags(nextTags);
    exitSelect();
    setBatchMsg(null);

    // 发请求；失败回滚（用本次渲染闭包里的 snippets/tags 快照）
    const body: Record<string, unknown> = { ids: selectedIds, action };
    if (action === "pin") body.pinned = target;
    if (action === "addTag" || action === "removeTag") body.tag = tag;

    try {
      const res = await fetch("/api/snippets/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
    } catch (e) {
      setSnippets(snippets);
      setTags(tags);
      if (action === "delete") setTotal((prev) => prev + selectedIds.length);
      setBatchMsg(e instanceof Error ? e.message : "操作失败");
      window.setTimeout(() => setBatchMsg(null), 3000);
    }
  };

  const handleExport = async () => {
    if (selectedIds.length === 0) return;
    setExportMsg(null);
    try {
      const res = await fetch("/api/snippets/export-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导出失败");
      router.push(`/editor/${data.articleId}`);
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : "导出失败");
      window.setTimeout(() => setExportMsg(null), 3000);
    }
  };

  // 派生 tagColors map（仅有效色），下传给卡片 pill 着色
  const tagColors: Record<string, string> = {};
  for (const t of tags) {
    if (isValidTagColor(t.color)) tagColors[t.name] = t.color;
  }

  // 搜索框非空时用 API 结果；每页固定 10 条，保留 cursor 供滚动继续加载。
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setNextCursor(initialNextCursor);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/snippets?q=${encodeURIComponent(q)}&limit=10`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          snippets: SnippetItem[];
          nextCursor: string | null;
        };
        setSearchResults(data.snippets ?? []);
        setNextCursor(data.nextCursor ?? null);
      } catch {
        if (!controller.signal.aborted) setSearchResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [searchQuery, initialNextCursor]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const q = searchQuery.trim();
    try {
      const params = new URLSearchParams({ cursor: nextCursor, limit: "10" });
      if (q) params.set("q", q);
      const res = await fetch(`/api/snippets?${params}`);
      const data = (await res.json()) as {
        snippets: SnippetItem[];
        nextCursor: string | null;
      };
      if (!res.ok) throw new Error("加载失败");
      const appendUnique = (current: SnippetItem[]) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...(data.snippets ?? []).filter((item) => !existing.has(item.id))];
      };
      if (q) setSearchResults((current) => appendUnique(current ?? []));
      else setSnippets((current) => appendUnique(current));
      setNextCursor(data.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, searchQuery]);

  const baseList = searchResults ?? snippets;
  const filteredSnippets = baseList.filter((s) => {
    if (!snippetMatchesAllTags(s.tags, activeTags)) return false;
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

  const handleDeleted = (id: string) => {
    const removed = snippets.find((s) => s.id === id);
    setSnippets((prev) => prev.filter((s) => s.id !== id));
    setSearchResults((prev) => prev?.filter((s) => s.id !== id) ?? null);
    setTotal((prev) => Math.max(0, prev - 1));
    if (!removed) return;
    const delTags = removed.tags;
    if (delTags.length === 0) return;
    setTags((cur) =>
      cur
        .map((t) => (delTags.includes(t.name) ? { ...t, count: t.count - 1 } : t))
        .filter((t) => t.count > 0)
        .sort(sortByCount)
    );
  };

  const handleUpdated = (updated: SnippetItem) => {
    const before =
      snippets.find((s) => s.id === updated.id) ??
      searchResults?.find((s) => s.id === updated.id);
    setSnippets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setSearchResults((prev) =>
      prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev
    );
    if (!before) return;
    const { added, removed } = diffTagSets(before.tags, updated.tags);
    if (added.length === 0 && removed.length === 0) return;
    const deltas = new Map<string, number>();
    for (const t of added) deltas.set(t, (deltas.get(t) ?? 0) + 1);
    for (const t of removed) deltas.set(t, (deltas.get(t) ?? 0) - 1);
    setTags((cur) => applyTagDeltas(cur, deltas));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80 lg:w-96">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索灵感…"
            className="h-8 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {searching && (
          <span className="text-xs text-muted-foreground">搜索中…</span>
        )}
        {selectMode ? (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground">
              已选 {selectedIds.length} · 共 {total} 条
            </span>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={selectedIds.length === 0}
              className="text-xs rounded-md bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              导出为草稿
            </button>
            <BatchTagPicker
              mode="add"
              candidates={tags.map((t) => t.name)}
              label="加标签"
              disabled={selectedIds.length === 0}
              onPick={(tag) => void handleBatch("addTag", { tag })}
            />
            <BatchTagPicker
              mode="remove"
              candidates={removeCandidates}
              label="移除标签"
              disabled={selectedIds.length === 0}
              onPick={(tag) => void handleBatch("removeTag", { tag })}
            />
            <button
              type="button"
              onClick={() => void handleBatch("pin", { pinned: pinToggle.target })}
              disabled={selectedIds.length === 0}
              className="text-xs rounded-md border border-transparent px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Pin className="h-3 w-3" />
              {pinToggle.label}
            </button>
            <button
              type="button"
              onClick={() => void handleBatch("delete")}
              disabled={selectedIds.length === 0}
              className="text-xs rounded-md border border-transparent px-2 py-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Trash2 className="h-3 w-3" />
              删除
            </button>
            <button
              type="button"
              onClick={exitSelect}
              className="text-xs text-muted-foreground hover:text-foreground px-2"
            >
              取消
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 ml-auto">
            <button
              type="button"
              onClick={openQuickDialog}
              className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10"
            >
              <Plus className="h-3.5 w-3.5" />
              新建
            </button>
            <span className="text-xs text-muted-foreground">
              共 {total} 条灵感
            </span>
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              选择
            </button>
          </div>
        )}
      </div>

      {/* 移动端标签筛选（横向滚动 chips，桌面用侧栏） */}
      {tags.length > 0 && (
        <div className="md:hidden -mt-3 flex gap-2 overflow-x-auto flex-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tags.map(({ name, count }) => {
            const cls = getTagColorClasses(resolveTagColor(name, tagColors));
            const active = activeTags.includes(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => handleToggleTag(name)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs whitespace-nowrap",
                  active ? cls.active : "border-border text-muted-foreground"
                )}
              >
                <Hash className="h-3 w-3" />
                {name}
                <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      )}

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
          {exportMsg && (
            <p className="text-xs text-destructive mb-2">{exportMsg}</p>
          )}
          {batchMsg && (
            <p className="text-xs text-destructive mb-2">{batchMsg}</p>
          )}
          <SnippetList
            snippets={filteredSnippets}
            tagColors={tagColors}
            existingTags={tags.map((t) => t.name)}
            onDeleted={handleDeleted}
            onUpdated={handleUpdated}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            hasMore={!!nextCursor}
            loadingMore={loadingMore}
            onLoadMore={() => void loadMore()}
          />
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
