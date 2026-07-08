"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Pin, Trash2 } from "lucide-react";
import { SnippetCreateBar } from "./SnippetCreateBar";
import { SnippetList } from "./SnippetList";
import { SnippetTagSidebar } from "./SnippetTagSidebar";
import { snippetMatchesAllTags } from "@/lib/snippets/tag-filter";
import { isValidTagColor } from "@/lib/snippets/tag-colors";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { BatchTagPicker } from "./BatchTagPicker";
import {
  resolvePinToggle,
  collectTagsUnion,
  parseTags,
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
}

function sortByCount(a: TagEntry, b: TagEntry): number {
  return b.count - a.count || a.name.localeCompare(b.name);
}

export function SnippetsView({
  initialSnippets,
  tags: initialTags,
  totalCount,
}: SnippetsViewProps) {
  const router = useRouter();
  const [snippets, setSnippets] = useState<SnippetItem[]>(initialSnippets);
  const [tags, setTags] = useState<TagEntry[]>(initialTags);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SnippetItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [colorMsg, setColorMsg] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

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
  const removeCandidates = collectTagsUnion(selectedSnippets);

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
        for (const t of parseTags(s.tagsJson)) {
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
        const before = parseTags(s.tagsJson);
        const after =
          action === "addTag" ? mergeTag(before, tag) : removeTag(before, tag);
        const { added, removed } = diffTagSets(before, after);
        for (const t of added) deltas.set(t, (deltas.get(t) ?? 0) + 1);
        for (const t of removed) deltas.set(t, (deltas.get(t) ?? 0) - 1);
        return { ...s, tagsJson: JSON.stringify(after) };
      });
      nextTags = applyTagDeltas(tags, deltas);
    }

    // 乐观落地 + 退出选择
    setSnippets(nextSnippets);
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
        {selectMode ? (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground">
              已选 {selectedIds.length} · 共 {totalCount} 条
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
            <span className="text-xs text-muted-foreground">
              共 {totalCount} 条灵感
            </span>
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted"
            >
              选择
            </button>
          </div>
        )}
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
          />
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
