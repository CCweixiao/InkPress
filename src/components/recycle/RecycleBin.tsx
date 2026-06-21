"use client";

import { useEffect, useState, useTransition } from "react";
import {
  RotateCcw,
  Trash2,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  CheckSquare,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatDate, cn } from "@/lib/utils";

type ArticleItem = {
  id: string;
  title: string;
  spaceId: string | null;
  status: string;
  trashedAt: string | null;
  expiresAt: string | null;
};
type SpaceItem = {
  id: string;
  name: string;
  trashedAt: string | null;
  expiresAt: string | null;
};
type AssetItem = {
  id: string;
  name: string;
  kind: string;
  url: string;
  trashedAt: string | null;
  expiresAt: string | null;
};

type Type = "article" | "space" | "asset";

/** 选中项的唯一键：`${type}:${id}` */
function keyOf(type: Type, id: string) {
  return `${type}:${id}` as const;
}

function daysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export function RecycleBin({
  articles,
  spaces,
  assets,
}: {
  articles: ArticleItem[];
  spaces: SpaceItem[];
  assets: AssetItem[];
}) {
  const [items, setItems] = useState({ articles, spaces, assets });
  const [cleaning, setCleaning] = useState(false);
  const [, startTransition] = useTransition();
  const { confirm: confirmDialog, dialog: confirmElement } = useConfirm();
  // 多选：选中项的 `${type}:${id}` 集合
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setItems({ articles, spaces, assets });
  }, [articles, spaces, assets]);

  // 打开时懒清理过期项
  useEffect(() => {
    setCleaning(true);
    fetch("/api/recycle/cleanup", { method: "POST" })
      .then(() => fetch("/api/recycle").then((r) => r.json()))
      .then((data) => {
        if (data.articles) setItems(data);
      })
      .finally(() => setCleaning(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restore(type: Type, id: string) {
    const res = await fetch("/api/recycle/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, id }),
    });
    const data = await res.json();
    if (!res.ok) {
      window.alert(data.error || "恢复失败");
      return;
    }
    removeFromList(type, id);
  }

  async function purge(type: Type, id: string) {
    const ok = await confirmDialog({
      title: "彻底删除？",
      description: "彻底删除后无法恢复，该操作不可撤销。",
      confirmText: "彻底删除",
      cancelText: "取消",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await fetch("/api/recycle/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, id }),
      });
      if (res.ok) removeFromList(type, id);
      else window.alert("删除失败");
    });
  }

  /** 批量彻底删除 */
  async function purgeBatch() {
    if (selected.size === 0) return;
    const ok = await confirmDialog({
      title: `彻底删除 ${selected.size} 项？`,
      description: "彻底删除后无法恢复，该操作不可撤销。",
      confirmText: "彻底删除",
      cancelText: "取消",
      variant: "destructive",
    });
    if (!ok) return;
    const payload = Array.from(selected).map((k) => {
      const [type, id] = k.split(":") as [Type, string];
      return { type, id };
    });
    startTransition(async () => {
      const res = await fetch("/api/recycle/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      if (res.ok) {
        for (const { type, id } of payload) removeFromList(type, id);
        setSelected(new Set());
      } else {
        window.alert("批量删除失败");
      }
    });
  }

  function removeFromList(type: Type, id: string) {
    setItems((cur) => {
      if (type === "article")
        return { ...cur, articles: cur.articles.filter((a) => a.id !== id) };
      if (type === "space")
        return { ...cur, spaces: cur.spaces.filter((a) => a.id !== id) };
      return { ...cur, assets: cur.assets.filter((a) => a.id !== id) };
    });
    setSelected((cur) => {
      const next = new Set(cur);
      next.delete(keyOf(type, id));
      return next;
    });
  }

  function toggleSelect(type: Type, id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      const k = keyOf(type, id);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  /** 全选 / 取消全选（当前列表所有项） */
  function toggleSelectAll() {
    const allKeys = [
      ...items.articles.map((a) => keyOf("article", a.id)),
      ...items.spaces.map((s) => keyOf("space", s.id)),
      ...items.assets.map((a) => keyOf("asset", a.id)),
    ];
    setSelected((cur) => {
      // 若已全选 → 清空；否则全选
      const allSelected = allKeys.every((k) => cur.has(k));
      if (allSelected) {
        const next = new Set(cur);
        for (const k of allKeys) next.delete(k);
        return next;
      }
      return new Set([...cur, ...allKeys]);
    });
  }

  const total =
    items.articles.length + items.spaces.length + items.assets.length;
  const allKeys = [
    ...items.articles.map((a) => keyOf("article", a.id)),
    ...items.spaces.map((s) => keyOf("space", s.id)),
    ...items.assets.map((a) => keyOf("asset", a.id)),
  ];
  const allSelected = total > 0 && allKeys.every((k) => selected.has(k));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">回收站</h1>
          <p className="text-sm text-muted-foreground mt-1">
            删除的文章 / 空间 / 素材暂存于此，
            {cleaning ? "清理中…" : `共 ${total} 项`}。默认保留 30 天，过期自动清理。
          </p>
        </div>
      </div>

      {total === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-16 text-center text-muted-foreground">
          回收站为空
        </div>
      ) : (
        <>
          {/* 多选工具栏 */}
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-2 sticky top-14 z-10">
            <button
              onClick={toggleSelectAll}
              className="inline-flex items-center gap-1.5 text-sm hover:text-primary transition-colors"
            >
              {allSelected ? (
                <CheckSquare className="h-4 w-4" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              {allSelected ? "取消全选" : "全选"}
            </button>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <span className="text-xs text-muted-foreground">
                  已选 {selected.size} 项
                </span>
              )}
              <Button
                variant="destructive"
                size="sm"
                disabled={selected.size === 0}
                onClick={purgeBatch}
              >
                <Trash2 className="h-4 w-4" />
                批量删除{selected.size > 0 ? `（${selected.size}）` : ""}
              </Button>
            </div>
          </div>

          {/* 文章 */}
          {items.articles.length > 0 && (
            <Section title="文章" count={items.articles.length}>
              {items.articles.map((a) => (
                <Row
                  key={a.id}
                  selected={selected.has(keyOf("article", a.id))}
                  onToggleSelect={() => toggleSelect("article", a.id)}
                  icon={<FileText className="h-4 w-4 text-muted-foreground" />}
                  title={a.title || "无标题文章"}
                  subtitle={a.trashedAt ? `删除于 ${formatDate(a.trashedAt)}` : undefined}
                  daysLeft={daysLeft(a.expiresAt)}
                  onRestore={() => restore("article", a.id)}
                  onPurge={() => purge("article", a.id)}
                />
              ))}
            </Section>
          )}

          {/* 空间 */}
          {items.spaces.length > 0 && (
            <Section title="空间" count={items.spaces.length}>
              {items.spaces.map((s) => (
                <Row
                  key={s.id}
                  selected={selected.has(keyOf("space", s.id))}
                  onToggleSelect={() => toggleSelect("space", s.id)}
                  icon={<FolderOpen className="h-4 w-4 text-muted-foreground" />}
                  title={s.name}
                  subtitle={s.trashedAt ? `删除于 ${formatDate(s.trashedAt)}` : undefined}
                  daysLeft={daysLeft(s.expiresAt)}
                  onRestore={() => restore("space", s.id)}
                  onPurge={() => purge("space", s.id)}
                />
              ))}
            </Section>
          )}

          {/* 素材 */}
          {items.assets.length > 0 && (
            <Section title="素材" count={items.assets.length}>
              {items.assets.map((a) => (
                <Row
                  key={a.id}
                  selected={selected.has(keyOf("asset", a.id))}
                  onToggleSelect={() => toggleSelect("asset", a.id)}
                  icon={<ImageIcon className="h-4 w-4 text-muted-foreground" />}
                  title={a.name}
                  subtitle={a.trashedAt ? `删除于 ${formatDate(a.trashedAt)}` : undefined}
                  daysLeft={daysLeft(a.expiresAt)}
                  onRestore={() => restore("asset", a.id)}
                  onPurge={() => purge("asset", a.id)}
                />
              ))}
            </Section>
          )}
        </>
      )}

      {confirmElement}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground mb-2">
        {title}（{count}）
      </h2>
      <div className="rounded-md border border-border divide-y">
        {children}
      </div>
    </div>
  );
}

function Row({
  icon,
  title,
  subtitle,
  daysLeft,
  selected,
  onToggleSelect,
  onRestore,
  onPurge,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  daysLeft: number | null;
  selected: boolean;
  onToggleSelect: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors",
        selected && "bg-primary/5"
      )}
    >
      <button
        onClick={onToggleSelect}
        className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
        title={selected ? "取消选择" : "选择"}
        aria-label={selected ? "取消选择" : "选择"}
      >
        {selected ? (
          <CheckSquare className="h-4 w-4 text-primary" />
        ) : (
          <Square className="h-4 w-4" />
        )}
      </button>
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {daysLeft !== null && (
        <span
          className={cn(
            "text-xs shrink-0",
            daysLeft <= 3 ? "text-red-600" : "text-muted-foreground"
          )}
        >
          剩余 {daysLeft} 天
        </span>
      )}
      <button
        onClick={onRestore}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
        title="恢复"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        恢复
      </button>
      <button
        onClick={onPurge}
        className="text-muted-foreground hover:text-red-600 p-1 shrink-0"
        title="彻底删除"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
