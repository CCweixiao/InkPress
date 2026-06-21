"use client";

import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Code2,
  Link as LinkIcon,
  Strikethrough,
  Minus,
  Undo2,
  Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function EditorToolbar({ editor }: { editor: Editor }) {
  const items = [
    {
      icon: Bold,
      label: "加粗",
      action: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive("bold"),
    },
    {
      icon: Italic,
      label: "斜体",
      action: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive("italic"),
    },
    {
      icon: Strikethrough,
      label: "删除线",
      action: () => editor.chain().focus().toggleStrike().run(),
      active: editor.isActive("strike"),
    },
    {
      icon: Code,
      label: "行内代码",
      action: () => editor.chain().focus().toggleCode().run(),
      active: editor.isActive("code"),
    },
    {
      icon: Heading1,
      label: "一级标题",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      active: editor.isActive("heading", { level: 1 }),
    },
    {
      icon: Heading2,
      label: "二级标题",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive("heading", { level: 2 }),
    },
    {
      icon: Heading3,
      label: "三级标题",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: editor.isActive("heading", { level: 3 }),
    },
    {
      icon: List,
      label: "无序列表",
      action: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
    },
    {
      icon: ListOrdered,
      label: "有序列表",
      action: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive("orderedList"),
    },
    {
      icon: Quote,
      label: "引用",
      action: () => editor.chain().focus().toggleBlockquote().run(),
      active: editor.isActive("blockquote"),
    },
    {
      icon: Code2,
      label: "代码块",
      action: () => editor.chain().focus().toggleCodeBlock().run(),
      active: editor.isActive("codeBlock"),
    },
    {
      icon: Minus,
      label: "分隔线",
      action: () => editor.chain().focus().setHorizontalRule().run(),
      active: false,
    },
    {
      icon: LinkIcon,
      label: "链接",
      action: () => {
        const url = window.prompt("输入链接地址");
        if (url) editor.chain().focus().setLink({ href: url }).run();
      },
      active: editor.isActive("link"),
    },
    {
      icon: Undo2,
      label: "撤销",
      action: () => editor.chain().focus().undo().run(),
      active: false,
      disabled: !editor.can().undo(),
    },
    {
      icon: Redo2,
      label: "重做",
      action: () => editor.chain().focus().redo().run(),
      active: false,
      disabled: !editor.can().redo(),
    },
  ];

  return (
    <div className="editor-toolbar sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-slate-200/80 bg-white/95 p-1.5 shadow-sm backdrop-blur">
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          onClick={item.action}
          title={item.label}
          disabled={item.disabled}
          className={cn(
            "rounded-lg p-2 text-slate-500 transition-all hover:bg-blue-50 hover:text-blue-700 disabled:pointer-events-none disabled:opacity-30",
            item.active && "bg-blue-50 text-blue-700 shadow-inner"
          )}
        >
          <item.icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
