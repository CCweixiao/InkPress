"use client";

import { useEffect, useState } from "react";
import type { ThemeOption } from "@/components/editor/EditorWorkspace";

/**
 * 公众号实时预览（轻量，客户端）
 * - markdown-it 渲染成带 class 的 HTML
 * - 主题 CSS 注入 scoped <style>，浏览器原生渲染（不做 juice 内联）
 * - 发布时由后端 /api/preview 走完整 juice 内联流水线
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const MarkdownIt = (await import("markdown-it")).default;
      const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
      if (!cancelled) setHtml(md.render(markdown || ""));
    })();
    return () => {
      cancelled = true;
    };
  }, [markdown]);

  const cssVariables =
    `:root{--md-primary-color:${theme?.primaryColor ?? "#3f51b5"};}`;

  return (
    <div className="p-4">
      <div className="text-xs text-muted-foreground mb-2 px-1">公众号预览</div>
      <div className="mx-auto w-full max-w-[340px] bg-white rounded-[28px] shadow-lg overflow-hidden border border-border">
        <div className="h-6 bg-white" />
        <div className="px-4 pb-6">
          <h1 className="text-lg font-bold text-center py-3 text-[#1a1a1a]">
            {title || "无标题"}
          </h1>
          <style dangerouslySetInnerHTML={{ __html: cssVariables }} />
          <div
            className="md-preview-content prose-wx"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  );
}
