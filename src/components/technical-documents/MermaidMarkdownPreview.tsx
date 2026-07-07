"use client";

import { useEffect, useRef, useState } from "react";
import { renderMarkdown } from "@/lib/markdown/renderer";

function encodeSourceReferences(markdown: string) {
  const exact =
    /^((?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]+)#L(\d+)(?:-L?(\d+))?$/;
  const plain =
    /((?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]+)#L(\d+)(?:-L?(\d+))?/g;
  return markdown
    .split(/(`[^`\n]+`)/g)
    .map((segment) => {
      if (segment.startsWith("`") && segment.endsWith("`")) {
        const raw = segment.slice(1, -1);
        const match = raw.match(exact);
        if (!match) return segment;
        const [, pathname, start, end] = match;
        return `[\`${raw}\`](inkpress-source://${encodeURIComponent(pathname)}?start=${start}&end=${end ?? start})`;
      }
      return segment.replace(
        plain,
        (_full, pathname: string, start: string, end?: string) =>
          `[${pathname}#L${start}${end ? `-L${end}` : ""}](inkpress-source://${encodeURIComponent(pathname)}?start=${start}&end=${end ?? start})`
      );
    })
    .join("");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function replaceMermaidCodeBlocks(html: string) {
  return html.replace(
    /<section class="code-block">[\s\S]*?<pre class="hljs code__pre"><code class="language-mermaid">([\s\S]*?)<\/code><\/pre><\/section>/g,
    (_match, source: string) =>
      `<section class="mermaid" data-mermaid-source="${encodeURIComponent(source)}"></section>`
  );
}

/**
 * 将 markdown 渲染为 HTML，并在「脱离 React DOM 树的临时容器」中完成 mermaid 替换，
 * 最后把「含 SVG 的完整 HTML」交给 React 状态。这样 React 始终拥有最终 DOM
 * （包括 SVG），不会因重新渲染而用占位 HTML 覆盖已渲染的图——这正是
 * mermaid 在 React 中“只渲染一次 / 切换预览才出现”问题的根治方案。
 */
export function MermaidMarkdownPreview({
  markdown,
  onOpenSource,
}: {
  markdown: string;
  onOpenSource?: (source: {
    path: string;
    startLine: number;
    endLine: number;
  }) => void;
}) {
  const [html, setHtml] = useState("");
  /** renderKey 用于给每次渲染批次的 mermaid 节点分配唯一 id */
  const renderKeyRef = useRef(0);
  /** 跟踪上次初始化时使用的主题，避免每次渲染都重新 initialize（会重载系统字体） */
  const lastDarkModeRef = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 200ms 防抖：连续输入时只触发一次 mermaid 渲染
    const timer = setTimeout(() => {
      void (async () => {
        // 1. markdown → HTML，并将 mermaid 代码块替换为占位 section
        let baseHtml: string;
        try {
          baseHtml = replaceMermaidCodeBlocks(
            renderMarkdown(encodeSourceReferences(markdown))
          );
        } catch {
          baseHtml = String(markdown ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        }

        // 2. 在脱离 React DOM 树的临时容器中完成所有 DOM 改写
        const detached = document.createElement("div");
        detached.innerHTML = baseHtml;

        const nodes = Array.from(
          detached.querySelectorAll<HTMLElement>("[data-mermaid-source]")
        );

        if (nodes.length > 0) {
          let mermaid: typeof import("mermaid").default | null;
          try {
            mermaid = (await import("mermaid")).default;
          } catch (error) {
            mermaid = null;
            for (const node of nodes) {
              node.textContent =
                error instanceof Error
                  ? `Mermaid 加载失败：${error.message}`
                  : "Mermaid 加载失败";
              node.classList.add("text-red-600", "text-sm");
            }
          }
          if (mermaid) {
            const darkMode =
              document.documentElement.classList.contains("dark") ||
              (!document.documentElement.classList.contains("light") &&
                window.matchMedia("(prefers-color-scheme: dark)").matches);
            // 仅在主题变化时重新 initialize（initialize 会重载系统字体，频繁调用会卡顿）
            if (lastDarkModeRef.current !== darkMode) {
              mermaid.initialize({
                startOnLoad: false,
                securityLevel: "strict",
                theme: darkMode ? "dark" : "neutral",
                fontFamily:
                  "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
                flowchart: { htmlLabels: false },
              });
              lastDarkModeRef.current = darkMode;
            }
            const renderKey = renderKeyRef.current++;
            await Promise.all(
              nodes.map(async (node, index) => {
                const encodedSource = node.dataset.mermaidSource;
                const source = encodedSource
                  ? decodeHtmlEntities(decodeURIComponent(encodedSource)).trim()
                  : "";
                if (!source) return;
                try {
                  const result = await mermaid.render(
                    `inkpress-mermaid-${renderKey}-${index}`,
                    source
                  );
                  node.innerHTML = result.svg;
                  node.removeAttribute("data-mermaid-source");
                } catch (error) {
                  node.textContent =
                    error instanceof Error
                      ? `Mermaid 图表错误：${error.message}`
                      : "Mermaid 图表错误";
                  node.classList.add("text-red-600", "text-sm");
                }
              })
            );
          }
        }

        // 3. 把「含 SVG 的最终 HTML」交给 React 状态：React 成为最终 DOM 的唯一拥有者
        if (!cancelled) {
          setHtml(detached.innerHTML);
        }
      })();
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [markdown]);

  return (
    <div
      className="technical-markdown technical-markdown-preview max-w-none px-6 py-5 text-sm leading-7"
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest("a");
        const href = anchor?.getAttribute("href") ?? "";
        if (!href.startsWith("inkpress-source://")) return;
        event.preventDefault();
        const url = new URL(href);
        onOpenSource?.({
          path: decodeURIComponent(url.hostname + url.pathname),
          startLine: Number(url.searchParams.get("start") ?? 1),
          endLine: Number(url.searchParams.get("end") ?? 1),
        });
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
