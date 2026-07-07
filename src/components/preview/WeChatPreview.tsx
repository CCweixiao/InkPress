"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ListTree, Loader2, Search, Smartphone, X } from "lucide-react";
import type { ThemeOption } from "@/components/editor/EditorWorkspace";
import { cn } from "@/lib/utils";

type TocItem = {
  level: 1 | 2 | 3;
  text: string;
  occurrence: number;
  index: number;
};

const MANUAL_PREVIEW_THRESHOLD = 50000;

/**
 * 公众号实时预览
 * 直接调用与发布相同的服务端转换链路，保证代码高亮、主题 CSS 和最终内联样式一致。
 *
 * mermaid 渲染策略：在「脱离 React DOM 树的临时容器」中完成 SVG 替换后，
 * 再把含 SVG 的完整 HTML 交给 React 状态。这样 React 始终是最终 DOM 的唯一拥有者，
 * 不会因重新渲染而用原始 HTML 覆盖已渲染的 mermaid 图表。
 */
export function WeChatPreview({
  markdown,
  title,
  theme,
}: {
  markdown: string;
  title: string;
  theme: ThemeOption | null;
}) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [activeTocIndex, setActiveTocIndex] = useState(0);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [manualPreviewPending, setManualPreviewPending] = useState(false);
  const [tocQuery, setTocQuery] = useState("");
  const [tocMaxLevel, setTocMaxLevel] = useState<2 | 3>(3);
  const articleRef = useRef<HTMLElement | null>(null);
  const manualPreviewRequested = useRef(false);
  const lastRenderedMarkdown = useRef("");
  const lastRenderedThemeKey = useRef("");
  const previewCache = useRef<Map<string, string>>(new Map());

  const toc = useMemo(() => extractToc(markdown), [markdown]);
  const visibleToc = useMemo(() => {
    const query = tocQuery.trim().toLowerCase();
    return toc.filter(
      (item) =>
        item.level <= tocMaxLevel &&
        (!query || item.text.toLowerCase().includes(query))
    );
  }, [toc, tocMaxLevel, tocQuery]);
  const themeKey = theme
    ? `${theme.codeTheme}:${theme.primaryColor ?? ""}:${theme.cssContent.length}`
    : "";
  const manualPreviewMode = markdown.length > MANUAL_PREVIEW_THRESHOLD;

  useEffect(() => {
    if (!markdown.trim() || !theme) {
      setHtml("");
      setLoading(false);
      setManualPreviewPending(false);
      lastRenderedMarkdown.current = "";
      lastRenderedThemeKey.current = "";
      return;
    }

    const renderedCurrent =
      lastRenderedMarkdown.current === markdown &&
      lastRenderedThemeKey.current === themeKey;
    if (renderedCurrent) {
      setManualPreviewPending(false);
      return;
    }

    const cacheKey = `${themeKey}\n${markdown}`;
    const cached = previewCache.current.get(cacheKey);
    if (cached) {
      lastRenderedMarkdown.current = markdown;
      lastRenderedThemeKey.current = themeKey;
      setManualPreviewPending(false);
      setHtml(cached);
      return;
    }

    if (
      manualPreviewMode &&
      html &&
      !manualPreviewRequested.current &&
      lastRenderedThemeKey.current === themeKey
    ) {
      setManualPreviewPending(true);
      setLoading(false);
      return;
    }
    manualPreviewRequested.current = false;

    const controller = new AbortController();
    let cancelled = false;
    const renderDelay = manualPreviewMode
      ? 0
      : markdown.length > 30000
        ? 1200
        : markdown.length > 10000
          ? 700
          : 280;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            markdown,
            theme: {
              cssContent: theme.cssContent,
              codeTheme: theme.codeTheme,
              primaryColor: theme.primaryColor,
            },
          }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok || cancelled) return;

        // 在脱离 React DOM 树的临时容器中完成 mermaid 替换
        const detached = document.createElement("div");
        detached.innerHTML = data.html as string;

        const blocks = Array.from(
          detached.querySelectorAll<HTMLElement>("code.language-mermaid")
        );
        if (blocks.length > 0) {
          const mermaid = (await import("mermaid")).default;
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: document.documentElement.classList.contains("dark")
              ? "dark"
              : "neutral",
          });

          for (const [index, block] of blocks.entries()) {
            if (cancelled) return;

            const source = block.textContent?.trim();
            const target = block.closest(".code-block") ?? block.parentElement;
            if (!source || !target?.parentElement) continue;

            const preview = document.createElement("section");
            preview.className = "mermaid-preview";
            try {
              const result = await mermaid.render(
                `wechat-preview-mermaid-${index}-${crypto.randomUUID()}`,
                source
              );
              if (cancelled) return;
              preview.innerHTML = result.svg;
            } catch {
              preview.textContent = "流程图渲染失败";
            }
            target.replaceWith(preview);
          }
        }

        if (!cancelled) {
          const nextHtml = attachTocIndexes(detached.innerHTML);
          previewCache.current.set(cacheKey, nextHtml);
          if (previewCache.current.size > 8) {
            const oldest = previewCache.current.keys().next().value;
            if (oldest) previewCache.current.delete(oldest);
          }
          lastRenderedMarkdown.current = markdown;
          lastRenderedThemeKey.current = themeKey;
          setManualPreviewPending(false);
          setHtml(nextHtml);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("[preview] render failed", error);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, renderDelay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [html, manualPreviewMode, markdown, previewRefreshKey, theme, themeKey]);

  useEffect(() => {
    const article = articleRef.current;
    const scroller = article?.closest("aside");
    if (!article || !scroller) return;

    const updateActiveHeading = () => {
      const headings = Array.from(
        article.querySelectorAll<HTMLElement>(
          ".wechat-article-content [data-toc-index]"
        )
      );
      if (headings.length === 0) {
        setActiveTocIndex(0);
        return;
      }

      const scrollerTop = scroller.getBoundingClientRect().top;
      let active = 0;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top - scrollerTop <= 96) {
          active = Number(heading.dataset.tocIndex ?? 0);
        } else {
          break;
        }
      }
      setActiveTocIndex(active);
    };

    scroller.addEventListener("scroll", updateActiveHeading, { passive: true });
    updateActiveHeading();
    return () => scroller.removeEventListener("scroll", updateActiveHeading);
  }, [html]);

  const jumpToHeading = (item: TocItem) => {
    const root = articleRef.current;
    if (!root) return;

    const target =
      root.querySelector<HTMLElement>(
        `.wechat-article-content [data-toc-index="${item.index}"]`
      ) ??
      Array.from(
        root.querySelectorAll<HTMLElement>(
          ".wechat-article-content h1, .wechat-article-content h2, .wechat-article-content h3"
        )
      ).find((heading) => heading.textContent?.trim() === item.text);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveTocIndex(item.index);
    setTocOpen(false);
  };

  return (
    <div className="px-4 py-5">
      <div className="mb-3 flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Smartphone className="h-3.5 w-3.5" />
          公众号文章预览
        </span>
        <span className="flex items-center gap-1 text-[10px]">
          {manualPreviewPending && (
            <button
              type="button"
              onClick={() => {
                manualPreviewRequested.current = true;
                setPreviewRefreshKey((key) => key + 1);
              }}
              className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              刷新预览
            </button>
          )}
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          {theme?.name ?? "默认主题"}
        </span>
      </div>

      <div className="wechat-phone relative mx-auto w-full max-w-[350px] overflow-hidden rounded-[30px] border border-neutral-200 bg-white shadow-[0_22px_60px_rgba(0,0,0,0.12)] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-[0_22px_60px_rgba(0,0,0,0.4)]">
        <div className="flex h-9 items-center justify-center border-b border-neutral-100 bg-white dark:border-neutral-700 dark:bg-neutral-900">
          <span className="h-1.5 w-14 rounded-full bg-neutral-200 dark:bg-neutral-600" />
        </div>
        <button
          type="button"
          disabled={toc.length === 0}
          onClick={() => setTocOpen((open) => !open)}
          title={toc.length === 0 ? "当前文章暂无标题目录" : "文章目录"}
          aria-label="文章目录"
          className={cn(
            "absolute right-4 top-12 z-20 rounded-full border border-neutral-200 bg-white/95 p-2 text-neutral-500 shadow-sm backdrop-blur transition-colors hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-35 dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-400 dark:hover:text-neutral-100",
            tocOpen && "text-neutral-900 dark:text-neutral-100"
          )}
        >
          {tocOpen ? <X className="h-4 w-4" /> : <ListTree className="h-4 w-4" />}
        </button>
        {tocOpen && toc.length > 0 && (
          <div className="absolute right-4 top-[5.75rem] z-20 max-h-[320px] w-[260px] overflow-y-auto rounded-xl border border-neutral-200 bg-white/[0.98] p-2 text-sm shadow-xl backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/[0.98]">
            <div className="flex items-center justify-between px-2 pb-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
              <span>文章目录</span>
              <span>{visibleToc.length}/{toc.length}</span>
            </div>
            <label className="mb-1.5 flex h-8 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
              <Search className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
              <input
                value={tocQuery}
                onChange={(event) => setTocQuery(event.target.value)}
                placeholder="搜索标题"
                className="min-w-0 flex-1 bg-transparent text-neutral-700 outline-none placeholder:text-neutral-400 dark:text-neutral-200"
              />
            </label>
            <div className="mb-1.5 flex gap-1 px-0.5">
              {([2, 3] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setTocMaxLevel(level)}
                  className={cn(
                    "rounded-md border border-neutral-200 px-2 py-1 text-[10px] text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800",
                    tocMaxLevel === level &&
                      "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                  )}
                >
                  显示到 H{level}
                </button>
              ))}
            </div>
            {visibleToc.map((item, index) => (
              <button
                key={`${item.text}-${item.level}-${item.occurrence}-${index}`}
                type="button"
                onClick={() => jumpToHeading(item)}
                className={cn(
                  "block w-full truncate rounded-md py-1.5 pr-2 text-left leading-5 text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800",
                  item.level === 1 && "pl-2 font-medium",
                  item.level === 2 && "pl-5",
                  item.level === 3 && "pl-8 text-neutral-500 dark:text-neutral-400",
                  activeTocIndex === item.index &&
                    "bg-neutral-100 text-neutral-950 dark:bg-neutral-800 dark:text-neutral-50"
                )}
                title={item.text}
              >
                {item.text}
              </button>
            ))}
          </div>
        )}
        <article ref={articleRef} className="wechat-article px-5 pb-10 pt-6">
          <header className="mb-7 border-b border-neutral-100 pb-5 dark:border-neutral-700">
            <h1 className="m-0 text-[22px] font-bold leading-[1.45] tracking-[-0.02em] text-[#171717] dark:text-neutral-100">
              {title || "无标题文章"}
            </h1>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-[#9a9a9a] dark:text-neutral-500">
              <span className="font-medium text-[#576b95]">InkPress</span>
              <span>·</span>
              <span>刚刚</span>
            </div>
          </header>

          {html ? (
            <div
              className="wechat-article-content"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <div className="py-20 text-center">
              <div className="mx-auto mb-3 h-10 w-10 rounded-2xl bg-neutral-50 dark:bg-neutral-800" />
              <p className="text-xs leading-6 text-neutral-400 dark:text-neutral-500">
                开始写作后，精美排版会实时呈现在这里
              </p>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

function extractToc(markdown: string): TocItem[] {
  const result: TocItem[] = [];
  const seen = new Map<string, number>();
  let inFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;

    const text = match[2].trim();
    if (!text) continue;

    const occurrence = seen.get(text) ?? 0;
    seen.set(text, occurrence + 1);
    result.push({
      level: match[1].length as 1 | 2 | 3,
      text,
      occurrence,
      index: result.length,
    });
  }

  return result;
}

function attachTocIndexes(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  container
    .querySelectorAll<HTMLElement>("h1, h2, h3")
    .forEach((heading, index) => {
      heading.dataset.tocIndex = String(index);
    });
  return container.innerHTML;
}
