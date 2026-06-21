"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";

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

export function MermaidMarkdownPreview({
  markdown,
  onOpenSource,
}: {
  markdown: string;
  onOpenSource: (source: {
    path: string;
    startLine: number;
    endLine: number;
  }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderKey, setRenderKey] = useState(0);
  const html = useMemo(() => {
    const mermaidBlocks: string[] = [];
    const replaced = encodeSourceReferences(markdown).replace(
      /```mermaid\s*\n([\s\S]*?)```/g,
      (_match, source: string) => {
        const index = mermaidBlocks.push(source.trim()) - 1;
        return `<div class="mermaid" data-mermaid-index="${index}"></div>`;
      }
    );
    const md = new MarkdownIt({ html: true, linkify: true, breaks: false });
    md.validateLink = (url) =>
      url.startsWith("inkpress-source://") || !/^(javascript|data):/i.test(url);
    return { content: md.render(replaced), mermaidBlocks };
  }, [markdown]);

  useEffect(() => {
    let cancelled = false;
    async function renderDiagrams() {
      const container = containerRef.current;
      if (!container) return;
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
      });
      const nodes = container.querySelectorAll<HTMLElement>("[data-mermaid-index]");
      await Promise.all(
        [...nodes].map(async (node, index) => {
          const source = html.mermaidBlocks[Number(node.dataset.mermaidIndex)];
          if (!source) return;
          try {
            const result = await mermaid.render(
              `inkpress-mermaid-${renderKey}-${index}`,
              source
            );
            if (!cancelled) node.innerHTML = result.svg;
          } catch (error) {
            if (!cancelled) {
              node.textContent =
                error instanceof Error ? `Mermaid 图表错误：${error.message}` : "Mermaid 图表错误";
              node.classList.add("text-red-600", "text-sm");
            }
          }
        })
      );
    }
    void renderDiagrams();
    setRenderKey((value) => value + 1);
    return () => {
      cancelled = true;
    };
    // renderKey is deliberately excluded; it only provides unique Mermaid ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  return (
    <div
      ref={containerRef}
      className="technical-markdown prose prose-slate max-w-none px-6 py-5 text-sm leading-7"
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest("a");
        const href = anchor?.getAttribute("href") ?? "";
        if (!href.startsWith("inkpress-source://")) return;
        event.preventDefault();
        const url = new URL(href);
        onOpenSource({
          path: decodeURIComponent(url.hostname + url.pathname),
          startLine: Number(url.searchParams.get("start") ?? 1),
          endLine: Number(url.searchParams.get("end") ?? 1),
        });
      }}
      dangerouslySetInnerHTML={{ __html: html.content }}
    />
  );
}
