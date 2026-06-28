"use client";

import { useEffect, useState } from "react";
import { Loader2, Smartphone } from "lucide-react";
import type { ThemeOption } from "@/components/editor/EditorWorkspace";

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

  useEffect(() => {
    if (!markdown.trim() || !theme) {
      setHtml("");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
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
          setHtml(detached.innerHTML);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("[preview] render failed", error);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [markdown, theme]);

  return (
    <div className="px-4 py-5">
      <div className="mb-3 flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Smartphone className="h-3.5 w-3.5" />
          公众号文章预览
        </span>
        <span className="flex items-center gap-1 text-[10px]">
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          {theme?.name ?? "默认主题"}
        </span>
      </div>

      <div className="wechat-phone mx-auto w-full max-w-[350px] overflow-hidden rounded-[30px] border border-neutral-200 bg-white shadow-[0_22px_60px_rgba(0,0,0,0.12)] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-[0_22px_60px_rgba(0,0,0,0.4)]">
        <div className="flex h-9 items-center justify-center border-b border-neutral-100 bg-white dark:border-neutral-700 dark:bg-neutral-900">
          <span className="h-1.5 w-14 rounded-full bg-neutral-200 dark:bg-neutral-600" />
        </div>
        <article className="wechat-article px-5 pb-10 pt-6">
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
