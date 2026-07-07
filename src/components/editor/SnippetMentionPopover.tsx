"use client";

import { Fragment } from "react";
import { Sparkles, Image as ImageIcon, Quote, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SnippetSearchItem } from "./at-commands";

function KindIcon({ kind }: { kind: string }) {
  if (kind === "image") return <ImageIcon className="h-3 w-3 text-muted-foreground" />;
  if (kind === "quote") return <Quote className="h-3 w-3 text-muted-foreground" />;
  if (kind === "link") return <LinkIcon className="h-3 w-3 text-muted-foreground" />;
  return null;
}

/** @ 触发的灵感检索浮动面板（镜像 SlashMenu 的浮层/键盘高亮/onMouseDown 防失焦）。 */
export function SnippetMentionPopover({
  items,
  activeIndex,
  loading,
  error,
  onRetry,
  onSelect,
}: {
  items: SnippetSearchItem[];
  activeIndex: number;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onSelect: (item: SnippetSearchItem) => void;
}) {
  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 max-h-72 w-80 overflow-y-auto rounded-lg border bg-background p-1 shadow-md">
      {loading && (
        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
          检索中…
        </div>
      )}
      {!loading && error && (
        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
          加载失败，<button type="button" className="text-primary underline" onClick={onRetry}>重试</button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
          未找到匹配的灵感
        </div>
      )}
      {!loading && !error && items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(item);
          }}
          className={cn(
            "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
            index === activeIndex && "bg-accent"
          )}
        >
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt=""
              className="mt-0.5 h-8 w-8 shrink-0 rounded object-cover"
            />
          ) : (
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <KindIcon kind={item.kind} />
              <span className="block truncate font-medium text-foreground">
                {item.title || item.summary.slice(0, 20)}
              </span>
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {item.summary}
            </span>
            {item.tags.length > 0 && (
              <span className="mt-0.5 block truncate text-[10px] text-primary/70">
                {item.tags.map((t) => `#${t}`).join(" ")}
              </span>
            )}
          </span>
        </button>
      ))}
      <div className="mt-0.5 border-t px-2 py-1 text-[10px] text-muted-foreground">
        ↑↓ 选择 · Tab/Enter 确认 · Esc 关闭
      </div>
    </div>
  );
}
