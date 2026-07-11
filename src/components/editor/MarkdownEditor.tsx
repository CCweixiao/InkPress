"use client";

import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { TiptapEditor } from "./TiptapEditor";

export type MarkdownEditorMode = "article" | "snippet" | "task";

/**
 * InkPress 统一 Markdown 编辑器。
 *
 * 对外始终读写 Markdown 字符串，对内统一使用所见即所得编辑体验。
 * 文章复制 Markdown 等外围操作由各业务页面按需提供。
 */
export function MarkdownEditor({
  value,
  onChange,
  articleId,
  placeholder,
  mode = "article",
  onEditorReady,
  className,
}: {
  value: string;
  onChange: (markdown: string) => void;
  articleId?: string;
  placeholder?: string;
  mode?: MarkdownEditorMode;
  onEditorReady?: (editor: Editor) => void;
  className?: string;
}) {
  return (
    <div className={cn("markdown-editor", className)} data-editor-mode={mode}>
      <TiptapEditor
        value={value}
        onChange={onChange}
        articleId={articleId}
        placeholder={placeholder}
        mode={mode === "snippet" ? "snippet" : "article"}
        onEditorReady={onEditorReady}
      />
    </div>
  );
}
