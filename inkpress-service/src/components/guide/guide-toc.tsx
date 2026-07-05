"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { GuideTocItem } from "@/lib/guide-markdown";

type GuideTocProps = {
  items: GuideTocItem[];
};

/**
 * 本页目录（TOC）：sticky 渲染在文章右侧。
 *
 * - IntersectionObserver 监听所有 heading，激活「最靠近视口顶部 1/4 区域」的那一个。
 * - 仅当 items.length >= 3 时渲染，避免极短文章出现单薄目录。
 * - 不含 h1：h1 即文章自身主标题，已在顶部展示。
 */
export function GuideToc({ items }: GuideTocProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const visibleItems = items.filter((item) => item.level > 1);

  useEffect(() => {
    if (visibleItems.length === 0) return;

    const headings = visibleItems
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);

    if (headings.length === 0) return;

    // rootMargin 顶部留 25%：heading 进入视口顶部 1/4 区域时被激活，
    // 多个同时可见时取最靠上的（entries 按 DOM 顺序，需手动比较位置）。
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
          );
        if (intersecting[0]) {
          setActiveId(intersecting[0].target.id);
        }
      },
      { rootMargin: "0px 0px -75% 0px", threshold: [0, 1] }
    );

    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  if (visibleItems.length < 3) return null;

  const minLevel = Math.min(...visibleItems.map((i) => i.level));

  return (
    <nav aria-label="本页目录" className="text-sm">
      <ul className="border-l border-border">
        {visibleItems.map((item, idx) => {
          const indent = (item.level - minLevel) * 12;
          const isActive = item.id === activeId;
          return (
            <li key={`${item.id}-${idx}`} style={{ paddingLeft: `${indent}px` }}>
              <a
                href={`#${item.id}`}
                className={cn(
                  "-ml-px block border-l-2 border-transparent py-1 pl-3 pr-2 text-xs leading-5 text-muted-foreground transition-colors hover:border-border hover:text-foreground",
                  isActive && "border-primary text-primary"
                )}
              >
                {item.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
