"use client";

import { useEffect, useRef } from "react";
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
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border bg-background shadow-lg">
      <div className="flex h-9 items-center justify-between border-b px-3">
        <span className="text-xs font-medium">选择灵感</span>
        {!loading && !error && items.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {items.length} 条候选
          </span>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto p-1">
        {loading && (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            检索中…
          </div>
        )}
        {!loading && error && (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            加载失败，
            <button type="button" className="text-primary underline" onClick={onRetry}>
              重试
            </button>
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
            ref={index === activeIndex ? activeItemRef : undefined}
            type="button"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
            className={cn(
              "relative flex min-h-14 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
              index === activeIndex &&
                "bg-accent text-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
            )}
          >
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt=""
                className="mt-0.5 h-9 w-9 shrink-0 rounded object-cover"
              />
            ) : (
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded bg-primary/8">
                <Sparkles className="h-4 w-4 text-primary" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <KindIcon kind={item.kind} />
                <span className="block truncate font-medium text-foreground">
                  {item.title || item.summary.slice(0, 20)}
                </span>
              </span>
              <span className="line-clamp-2 text-[10px] leading-4 text-muted-foreground">
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
        {!loading && !error && items.length >= 20 && (
          <div className="px-2 py-2 text-center text-[10px] text-muted-foreground">
            结果较多，继续输入关键词可快速筛选
          </div>
        )}
      </div>
      <div className="border-t bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
        ↑↓ 选择 · Tab/Enter 确认 · Esc 关闭
      </div>
    </div>
  );
}
