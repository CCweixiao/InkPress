"use client";

import { useState } from "react";
import { Pin, Trash2, Quote, Link as LinkIcon, Pencil, RefreshCw, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  resolveTagColor,
  getTagColorClasses,
} from "@/lib/snippets/tag-colors";
import { Markdown } from "@/components/ai/Markdown";
import {
  getFirstMarkdownImage,
  stripMarkdownImages,
} from "@/lib/markdown/images";
import { isSafeMarkdownUrl } from "@/lib/markdown/safe-url";
import { SnippetEditInline } from "./SnippetEditInline";
import type { SnippetItem } from "./types";

interface SnippetCardProps {
  snippet: SnippetItem;
  tagColors: Record<string, string>;
  existingTags?: string[];
  onDeleted: (id: string) => void;
  onUpdated: (snippet: SnippetItem) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  return date.toLocaleDateString("zh-CN");
}

export function SnippetCard({
  snippet,
  tagColors,
  existingTags,
  onDeleted,
  onUpdated,
  selectMode,
  selected,
  onToggleSelect,
}: SnippetCardProps) {
  const [editing, setEditing] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [refetchMsg, setRefetchMsg] = useState<string | null>(null);
  const tags: string[] = snippet.tags;
  const firstMarkdownImage =
    snippet.kind === "text" ? getFirstMarkdownImage(snippet.content) : null;
  const markdownImage =
    firstMarkdownImage && isSafeMarkdownUrl(firstMarkdownImage.src)
      ? firstMarkdownImage
      : null;
  const markdownText =
    markdownImage ? stripMarkdownImages(snippet.content) : snippet.content;

  async function handleRefetch() {
    setRefetching(true);
    setRefetchMsg(null);
    try {
      const res = await fetch(`/api/snippets/${snippet.id}/refetch-og`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "抓取失败");
      onUpdated(data.snippet);
      setRefetchMsg("✓ 已更新");
    } catch (e) {
      setRefetchMsg(e instanceof Error ? e.message : "抓取失败");
    } finally {
      setRefetching(false);
      window.setTimeout(() => setRefetchMsg(null), 2000);
    }
  }

  const handlePin = async () => {
    const res = await fetch(`/api/snippets/${snippet.id}/pin`, {
      method: "POST",
    });
    if (res.ok) {
      const { snippet: updated } = await res.json();
      onUpdated(updated);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("确定删除这条灵感？删除后可在回收站找回。")) return;
    const res = await fetch(`/api/snippets/${snippet.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      onDeleted(snippet.id);
    }
  };

  return (
    <>
    <Card
      className={cn(
        "group relative flex h-[22rem] flex-col overflow-hidden p-4 transition-all break-inside-avoid",
        selectMode
          ? "cursor-pointer hover:ring-2 hover:ring-primary/40"
          : "hover:shadow-md cursor-default",
        snippet.pinned && "ring-1 ring-primary/30",
        selected && "ring-2 ring-primary"
      )}
      onClick={selectMode ? onToggleSelect : undefined}
      onDoubleClick={(event) => {
        if (selectMode) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest("button, input, a")) return;
        setEditing(true);
      }}
    >
      {/* 选择态 checkbox（左上角） */}
      {selectMode && (
        <div className="absolute top-2 left-2 z-10 flex h-5 w-5 items-center justify-center rounded border border-primary bg-background">
          <input
            type="checkbox"
            checked={!!selected}
            readOnly
            className="h-4 w-4 accent-primary"
          />
        </div>
      )}
      {/* 操作按钮（悬停显示；选择模式下隐藏） */}
      {!selectMode && (
        <div
          onDoubleClick={(event) => event.stopPropagation()}
          className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-border/60 bg-background/90 p-0.5 shadow-sm backdrop-blur-sm opacity-100 focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
        >
          {snippet.kind === "link" && (
          <button
            type="button"
            onClick={() => void handleRefetch()}
            disabled={refetching}
            className="p-1.5 md:p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="重新抓取链接信息"
            aria-label="重新抓取链接信息"
          >
            {refetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        <button
          onClick={() => setEditing(true)}
          className="p-1.5 md:p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="编辑"
          aria-label="编辑"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handlePin}
          className="p-1.5 md:p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={snippet.pinned ? "取消置顶" : "置顶"}
          aria-label={snippet.pinned ? "取消置顶" : "置顶"}
        >
          <Pin className={cn("h-3.5 w-3.5", snippet.pinned && "text-primary fill-primary")} />
        </button>
        <button
          onClick={handleDelete}
          className="p-1.5 md:p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="删除"
          aria-label="删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        </div>
      )}

      {/* 内容区 */}
      {snippet.kind === "image" && snippet.imageUrl && (
        <div className="mb-3 overflow-hidden rounded-lg border border-border/70 bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={snippet.imageUrl}
            alt={snippet.title}
            className="h-44 w-full object-cover"
          />
        </div>
      )}

      {snippet.kind === "quote" ? (
        <div className="flex gap-2 mb-2">
          <Quote className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm italic text-foreground/90">
              &ldquo;{snippet.content}&rdquo;
            </p>
            {snippet.quoteSource && (
              <p className="text-xs text-muted-foreground mt-1">
                —— {snippet.quoteSource}
              </p>
            )}
          </div>
        </div>
      ) : snippet.kind === "link" ? (
        <div className="mb-2">
          {snippet.linkImage && (
            // 原生 <img>：OG 图来自任意域，next/image 需配 remotePatterns 不划算；
            // onError 隐藏坏图，referrerPolicy 防 Referer 泄露。
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={snippet.linkImage}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
              className="w-full h-32 object-cover rounded-md mb-2 bg-muted"
            />
          )}
          <div className="flex items-center gap-1.5 mb-1">
            <LinkIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">
              {snippet.linkTitle || snippet.linkUrl}
            </span>
          </div>
          {snippet.linkDescription && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
              {snippet.linkDescription}
            </p>
          )}
          {snippet.linkUrl && (
            <p className="text-xs text-muted-foreground truncate">
              {snippet.linkUrl}
            </p>
          )}
          {snippet.content && (
            <p className="mt-1 line-clamp-3 text-sm text-foreground/80">{snippet.content}</p>
          )}
          {refetchMsg && (
            <p className="text-xs text-muted-foreground mt-1">{refetchMsg}</p>
          )}
        </div>
      ) : (
        <>
          {markdownImage && (
            <div className="snippet-card-gallery mb-3 overflow-hidden rounded-lg border border-border/70 bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={markdownImage.src}
                alt={markdownImage.alt}
                loading="lazy"
                className="h-44 w-full object-cover"
              />
            </div>
          )}
          {markdownText && (
            <Markdown className="snippet-card-markdown text-sm text-foreground/90">
              {markdownText}
            </Markdown>
          )}
        </>
      )}

      {/* 底部：标签 + 时间 */}
      <div className="mt-auto flex items-center gap-2 border-t border-border/50 pt-2 text-xs text-muted-foreground">
        {tags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {tags.slice(0, 3).map((t) => {
              const color = resolveTagColor(t, tagColors);
              return (
                <span
                  key={t}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs",
                    color ? getTagColorClasses(color).pill : "text-primary/70"
                  )}
                >
                  #{t}
                </span>
              );
            })}
            {tags.length > 3 && (
              <span className="text-muted-foreground">+{tags.length - 3}</span>
            )}
          </span>
        )}
        <span className="ml-auto">{formatRelativeTime(snippet.createdAt)}</span>
      </div>
    </Card>
    <Dialog open={editing} onOpenChange={setEditing}>
      <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑灵感</DialogTitle>
        </DialogHeader>
        {snippet.kind === "image" && snippet.imageUrl && (
          <div className="overflow-hidden rounded-lg border border-border/70 bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={snippet.imageUrl}
              alt={snippet.title}
              className="max-h-52 w-full object-cover"
            />
          </div>
        )}
        <SnippetEditInline
          snippet={snippet}
          existingTags={existingTags}
          onSave={(updated) => {
            setEditing(false);
            onUpdated(updated);
          }}
          onCancel={() => setEditing(false)}
        />
      </DialogContent>
    </Dialog>
    </>
  );
}
