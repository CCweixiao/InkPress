"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { ThemeOption } from "@/components/editor/EditorWorkspace";

/** 公众号基础排版（所有主题共享的下限样式） */
const BASE_CSS = `
.md-wx{font-size:16px;color:#1a1a1a;line-height:1.75;word-wrap:break-word;}
.md-wx p{margin:0.75em 0;}
.md-wx a{color:#576b95;}
.md-wx strong{font-weight:bold;}
.md-wx pre{overflow-x:auto;padding:1em;border-radius:6px;}
.md-wx img{max-width:100%;}
.md-wx table{border-collapse:collapse;width:100%;}
.md-wx th,.md-wx td{border:1px solid #ddd;padding:6px 12px;}
`;

/**
 * 公众号实时预览（轻量，客户端）
 * - markdown-it 渲染成 HTML
 * - 主题 CSS 经 resolveCssVariables 解析后注入 scoped <style>，浏览器原生渲染
 * - 不做 juice 内联（发布时由后端 /api/preview 走完整流水线）
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
  const scopeId = useId().replace(/[:]/g, "");

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

  // 把主题 CSS 的裸选择器 scope 到预览容器（加 .md-wx-wxxxx 前缀）
  const scopedThemeCss = useMemo(() => {
    if (!theme) return "";
    const primary = theme.primaryColor ?? "#3f51b5";
    // 简易解析 var()（与后端 loader 一致的最小实现）
    let css = theme.cssContent
      .replace(/var\(--md-primary-color(-dark|-light|-bg)?\)/g, (_, m?: string) => {
        if (m === "-dark") return shade(primary, -0.15);
        if (m === "-light") return shade(primary, 0.15);
        if (m === "-bg") return primary + "10";
        return primary;
      })
      .replace(/var\(--md-font-size\)/g, "16px")
      .replace(/hsl\(var\(--foreground\)\)/g, "#1a1a1a")
      .replace(/hsl\(var\(--muted-foreground\)\)/g, "#999")
      .replace(/hsl\(var\(--background\)\)/g, "#ffffff");
    // 去掉注释，避免选择器前缀误伤
    css = css.replace(/\/\*[\s\S]*?\*\//g, "");
    // 给每条选择器加前缀
    return css.replace(/(^|\})\s*([^{}]+)\{/g, (_m, brace: string, selectors: string) => {
      const scoped = selectors
        .split(",")
        .map((s: string) => `.md-wx-${scopeId} ${s.trim()}`)
        .join(", ");
      return `${brace} ${scoped} {`;
    });
  }, [theme, scopeId]);

  return (
    <div className="p-4">
      <div className="text-xs text-muted-foreground mb-2 px-1 flex items-center justify-between">
        <span>公众号预览</span>
        <span className="text-[10px]">{theme?.name ?? "默认"}</span>
      </div>
      <div className="mx-auto w-full max-w-[340px] bg-white rounded-[28px] shadow-lg overflow-hidden border border-border">
        <div className="h-6 bg-white" />
        <div className={`px-4 pb-6 md-wx md-wx-${scopeId}`}>
          <h1 className="text-lg font-bold text-center py-3 text-[#1a1a1a]">
            {title || "无标题"}
          </h1>
          <style
            dangerouslySetInnerHTML={{
              __html: BASE_CSS + scopedThemeCss,
            }}
          />
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}

/** hex 颜色加深/变亮 */
function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  let r = clamp(Math.round(((num >> 16) & 0xff) * (1 + amount)));
  let g = clamp(Math.round(((num >> 8) & 0xff) * (1 + amount)));
  let b = clamp(Math.round((num & 0xff) * (1 + amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}
