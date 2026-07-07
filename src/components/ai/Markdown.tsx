"use client";

import { useMemo } from "react";
import MarkdownIt from "markdown-it";
import { cn } from "@/lib/utils";

let mdInstance: MarkdownIt | null = null;
function getMarkdown(): MarkdownIt {
  if (!mdInstance) {
    mdInstance = new MarkdownIt({
      html: false,
      linkify: true,
      breaks: true,
      typographer: false,
    });
    // 仅允许 http(s) 链接，拦截 javascript:/data: 等危险协议
    mdInstance.validateLink = (url) => /^https?:\/\//i.test(url);
  }
  return mdInstance;
}

/**
 * 轻量客户端 Markdown 渲染（用于对话气泡、思考摘要等）。
 * 复用 markdown-it（已是依赖），支持标题/列表/代码/链接/表格等基础语法。
 * 不含 Mermaid / 代码高亮（避免对话区重量化）；如需富渲染请用 MermaidMarkdownPreview。
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const html = useMemo(() => {
    try {
      return getMarkdown().render(children ?? "");
    } catch {
      // 渲染失败时退化为转义纯文本，避免白屏
      return String(children ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  }, [children]);

  return (
    <div
      className={cn("markdown-chat", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
