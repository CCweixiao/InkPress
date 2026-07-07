"use client";

import { useState } from "react";
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
  Table2,
  Undo2,
  Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function EditorToolbar({ editor }: { editor: Editor }) {
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [withHeaderRow, setWithHeaderRow] = useState(true);
  const [tablePopoverOpen, setTablePopoverOpen] = useState(false);

  const insertConfiguredTable = () => {
    editor
      .chain()
      .focus()
      .insertTable({
        rows: clampTableSize(tableRows),
        cols: clampTableSize(tableCols),
        withHeaderRow,
      })
      .run();
    setTablePopoverOpen(false);
  };

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
    <div className="editor-toolbar sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-background/95 p-1.5 shadow-sm backdrop-blur">
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          onClick={item.action}
          title={item.label}
          disabled={item.disabled}
          className={cn(
            "rounded-lg p-2 text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-30",
            item.active && "bg-accent text-accent-foreground shadow-inner"
          )}
        >
          <item.icon className="h-4 w-4" />
        </button>
      ))}
      <Popover open={tablePopoverOpen} onOpenChange={setTablePopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="插入表格"
            className={cn(
              "rounded-lg p-2 text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground",
              editor.isActive("table") && "bg-accent text-accent-foreground shadow-inner"
            )}
          >
            <Table2 className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium">插入表格</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                指定行列数后插入到当前光标位置
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                行数
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={tableRows}
                  onChange={(event) =>
                    setTableRows(clampTableSize(Number(event.target.value)))
                  }
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                列数
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={tableCols}
                  onChange={(event) =>
                    setTableCols(clampTableSize(Number(event.target.value)))
                  }
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={withHeaderRow}
                onChange={(event) => setWithHeaderRow(event.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              包含表头
            </label>
            <button
              type="button"
              onClick={insertConfiguredTable}
              className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              插入
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function clampTableSize(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(12, Math.round(value)));
}
