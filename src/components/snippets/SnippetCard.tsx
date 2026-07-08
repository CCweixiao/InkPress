"use client";

import { Pin, Trash2, Quote, Link as LinkIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  resolveTagColor,
  getTagColorClasses,
} from "@/lib/snippets/tag-colors";
import type { SnippetItem } from "./types";

interface SnippetCardProps {
  snippet: SnippetItem;
  tagColors: Record<string, string>;
  onDeleted: (id: string) => void;
  onUpdated: (snippet: SnippetItem) => void;
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

export function SnippetCard({ snippet, tagColors, onDeleted, onUpdated }: SnippetCardProps) {
  const tags: string[] = JSON.parse(snippet.tagsJson || "[]");

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
    <Card
      className={cn(
        "group relative p-4 transition-all hover:shadow-md cursor-default break-inside-avoid",
        snippet.pinned && "ring-1 ring-primary/30"
      )}
    >
      {/* 操作按钮（悬停显示） */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handlePin}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={snippet.pinned ? "取消置顶" : "置顶"}
          aria-label={snippet.pinned ? "取消置顶" : "置顶"}
        >
          <Pin className={cn("h-3.5 w-3.5", snippet.pinned && "text-primary fill-primary")} />
        </button>
        <button
          onClick={handleDelete}
          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="删除"
          aria-label="删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 内容区 */}
      {snippet.kind === "image" && snippet.imageUrl && (
        <div className="mb-3 rounded-lg overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={snippet.imageUrl}
            alt={snippet.title}
            className="w-full h-auto object-cover max-h-48"
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
          <div className="flex items-center gap-1.5 mb-1">
            <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium truncate">
              {snippet.linkTitle || snippet.linkUrl}
            </span>
          </div>
          {snippet.linkUrl && (
            <p className="text-xs text-muted-foreground truncate">
              {snippet.linkUrl}
            </p>
          )}
          {snippet.content && (
            <p className="text-sm text-foreground/80 mt-1">{snippet.content}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-foreground/90 whitespace-pre-wrap mb-2">
          {snippet.content}
        </p>
      )}

      {/* 底部：标签 + 时间 */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
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
  );
}
