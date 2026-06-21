"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { useEffect } from "react";
import { EditorToolbar } from "./EditorToolbar";
import { createImageUploadExtension } from "./extensions/ImageUpload";

export function TiptapEditor({
  value,
  onChange,
  articleId,
}: {
  value: string;
  onChange: (md: string) => void;
  articleId?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // StarterKit 自带 codeBlock，但无高亮；保持简洁，高亮在预览/转换层统一处理
        // StarterKit v3 已含 link 扩展，在此统一配置（避免重复注册告警）
        link: {
          openOnClick: false,
          HTMLAttributes: { class: "text-primary underline" },
        },
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      Placeholder.configure({
        placeholder: "开始写作，或从左侧用 AI 生成…",
      }),
      Image.configure({
        HTMLAttributes: { class: "rounded-lg" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      createImageUploadExtension(articleId),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap prose max-w-none focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      // tiptap-markdown 提供的 storage：导出 markdown 源
      const md = (editor.storage as unknown as { markdown?: { getMarkdown: () => string } })
        .markdown?.getMarkdown() ?? "";
      onChange(md);
    },
  });

  // 外部 value 变化（如 AI 生成应用）时同步进编辑器
  useEffect(() => {
    if (!editor) return;
    const current = (editor.storage as unknown as { markdown?: { getMarkdown: () => string } })
      .markdown?.getMarkdown() ?? "";
    if (value !== current) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div>
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

export type { Editor };
