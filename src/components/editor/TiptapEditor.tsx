"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Bold,
  CheckSquare,
  Code2,
  CornerDownLeft,
  CornerDownRight,
  CornerLeftDown,
  CornerRightDown,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Info,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  MoreHorizontal,
  Minus,
  Quote,
  Table2,
  Trash2,
} from "lucide-react";
import { EditorToolbar } from "./EditorToolbar";
import { createImageUploadExtension } from "./extensions/ImageUpload";
import { createSnippetDropExtension } from "./extensions/SnippetDrop";
import { cn } from "@/lib/utils";

type TableMenuState = {
  x: number;
  y?: number;
  bottom?: number;
  maxHeight: number;
  placement: "top" | "bottom";
} | null;

type SlashMenuState = {
  query: string;
  index: number;
  from: number;
  to: number;
  x: number;
  y?: number;
  bottom?: number;
  maxHeight: number;
  placement: "top" | "bottom";
} | null;

type SelectionMenuState = {
  x: number;
  y: number;
} | null;

type ImageMenuState = {
  x: number;
  y: number;
} | null;

type EditorSlashCommand = {
  label: string;
  description: string;
  aliases: string[];
  icon: typeof Heading1;
  run: (editor: Editor) => void;
};

function getImageMenuState(editor: Editor): ImageMenuState {
  if (!editor.isActive("image")) return null;

  const { view, state } = editor;
  const node = view.nodeDOM(state.selection.from);
  const image =
    node instanceof HTMLImageElement
      ? node
      : node instanceof Element
        ? node.querySelector("img")
        : null;
  if (!image) return null;

  const rect = image.getBoundingClientRect();
  const menuWidth = 82;
  const menuHeight = 42;
  const x = Math.min(
    Math.max(8, rect.left + rect.width / 2 - menuWidth / 2),
    window.innerWidth - menuWidth - 8
  );
  const y =
    rect.top > menuHeight + 12
      ? rect.top - menuHeight - 8
      : Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 8);
  return { x, y };
}

export function TiptapEditor({
  value,
  onChange,
  articleId,
  placeholder = "开始写作，或从左侧用 AI 生成…",
  onEditorReady,
  mode = "article",
}: {
  value: string;
  onChange: (md: string) => void;
  articleId?: string;
  placeholder?: string;
  mode?: "article" | "snippet";
  /** editor 实例就绪后回调一次（供父级做光标精确插入 / 选区读取）。 */
  onEditorReady?: (editor: Editor) => void;
}) {
  const [tableMenu, setTableMenu] = useState<TableMenuState>(null);
  const [tableToolsOpen, setTableToolsOpen] = useState(false);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>(null);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState>(null);
  const [imageMenu, setImageMenu] = useState<ImageMenuState>(null);
  const slashMenuRef = useRef<SlashMenuState>(null);

  useEffect(() => {
    slashMenuRef.current = slashMenu;
  }, [slashMenu]);

  const slashCommands = useMemo<EditorSlashCommand[]>(
    () => [
      {
        label: "一级标题",
        description: "大标题，用于文章主章节",
        aliases: ["h1", "标题", "一级"],
        icon: Heading1,
        run: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        label: "二级标题",
        description: "常用小节标题",
        aliases: ["h2", "小标题", "二级"],
        icon: Heading2,
        run: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        label: "三级标题",
        description: "更细的段落标题",
        aliases: ["h3", "三级"],
        icon: Heading3,
        run: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
      },
      {
        label: "无序列表",
        description: "项目符号列表",
        aliases: ["ul", "list", "列表", "无序"],
        icon: List,
        run: (ed) => ed.chain().focus().toggleBulletList().run(),
      },
      {
        label: "有序列表",
        description: "带编号的列表",
        aliases: ["ol", "ordered", "编号", "有序"],
        icon: ListOrdered,
        run: (ed) => ed.chain().focus().toggleOrderedList().run(),
      },
      {
        label: "任务清单",
        description: "可勾选的待办列表",
        aliases: ["todo", "task", "check", "清单", "待办"],
        icon: CheckSquare,
        run: (ed) => ed.chain().focus().toggleTaskList().run(),
      },
      {
        label: "引用",
        description: "突出一段引用或提示",
        aliases: ["quote", "blockquote", "引用"],
        icon: Quote,
        run: (ed) => ed.chain().focus().toggleBlockquote().run(),
      },
      {
        label: "提示块",
        description: "插入一段醒目的提示说明",
        aliases: ["tip", "info", "提示", "说明"],
        icon: Info,
        run: (ed) =>
          ed
            .chain()
            .focus()
            .insertContent("<blockquote><p><strong>提示：</strong>在这里补充说明。</p></blockquote>")
            .run(),
      },
      {
        label: "代码块",
        description: "插入多行代码",
        aliases: ["code", "代码", "代码块"],
        icon: Code2,
        run: (ed) => ed.chain().focus().toggleCodeBlock().run(),
      },
      {
        label: "图片",
        description: "通过图片 URL 插入",
        aliases: ["image", "img", "图片"],
        icon: ImageIcon,
        run: (ed) => {
          const url = window.prompt("输入图片地址");
          if (!url?.trim()) return;
          ed.chain().focus().setImage({ src: url.trim() }).run();
        },
      },
      {
        label: "分隔线",
        description: "插入居中的短分割线",
        aliases: ["hr", "line", "分割线", "分隔线"],
        icon: Minus,
        run: (ed) => ed.chain().focus().setHorizontalRule().run(),
      },
      {
        label: "表格",
        description: "插入 3 x 3 表格",
        aliases: ["table", "表格"],
        icon: Table2,
        run: (ed) =>
          ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      {
        label: "摘要模板",
        description: "插入适合文章收尾的小结结构",
        aliases: ["summary", "总结", "摘要", "模板"],
        icon: Heading2,
        run: (ed) =>
          ed
            .chain()
            .focus()
            .insertContent(
              "<h2>小结</h2><p>一句话总结核心观点。</p><ul><li><p>关键收获一</p></li><li><p>关键收获二</p></li><li><p>下一步建议</p></li></ul>"
            )
            .run(),
      },
    ],
    []
  );

  const visibleSlashCommands = useMemo(() => {
    const query = slashMenu?.query.trim().toLowerCase() ?? "";
    if (!query) return slashCommands;
    return slashCommands.filter(
      (command) =>
        command.label.toLowerCase().includes(query) ||
        command.aliases.some((alias) => alias.toLowerCase().includes(query))
    );
  }, [slashCommands, slashMenu?.query]);

  const editor = useEditor({
    enableInputRules: mode === "snippet" ? false : undefined,
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
        placeholder,
      }),
      Image.configure({
        inline: true,
        HTMLAttributes: { class: "rounded-lg" },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: { class: "tiptap-table" },
      }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      createImageUploadExtension(articleId),
      createSnippetDropExtension(),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap prose max-w-none focus:outline-none",
      },
      handleDOMEvents: {
        keydown: (_view: EditorView, event: KeyboardEvent) => {
          const current = slashMenuRef.current;
          if (!current) return false;

          if (event.key === "Escape") {
            event.preventDefault();
            setSlashMenu(null);
            return true;
          }

          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setSlashMenu((menu) => {
              if (!menu) return menu;
              const total = getVisibleSlashCommands(slashCommands, menu.query).length;
              if (total === 0) return menu;
              const delta = event.key === "ArrowDown" ? 1 : -1;
              return { ...menu, index: (menu.index + delta + total) % total };
            });
            return true;
          }

          if (event.key === "Enter" || event.key === "Tab") {
            const commands = getVisibleSlashCommands(slashCommands, current.query);
            const command = commands[current.index] ?? commands[0];
            if (!command || !editor) return false;
            event.preventDefault();
            runSlashCommand(editor, current, command);
            setSlashMenu(null);
            return true;
          }

          return false;
        },
        contextmenu: (view: EditorView, event: MouseEvent) => {
          const target = event.target;
          if (!(target instanceof Element) || !target.closest("table")) {
            setTableMenu(null);
            return false;
          }

          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (pos) {
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.near(view.state.doc.resolve(pos.pos))
              )
            );
          }
          setTableMenu({
            x: Math.min(event.clientX, window.innerWidth - 220),
            ...getAnchoredMenuPosition({
              top: event.clientY,
              bottom: event.clientY,
              idealHeight: 330,
              minHeight: 180,
              gap: 8,
            }),
          });
          setTableToolsOpen(false);
          return true;
        },
      },
      transformPastedText: (text: string) => normalizePastedMarkdownTables(text),
    },
    onUpdate: ({ editor }) => {
      // tiptap-markdown 提供的 storage：导出 markdown 源
      const md = (editor.storage as unknown as { markdown?: { getMarkdown: () => string } })
        .markdown?.getMarkdown() ?? "";
      onChange(md);
    },
  }, [mode]);

  // editor 实例就绪后回调一次（供父级做光标精确插入 / 选区读取）
  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  // 外部 value 变化（如 AI 生成应用）时同步进编辑器
  useEffect(() => {
    if (!editor) return;
    const current = (editor.storage as unknown as { markdown?: { getMarkdown: () => string } })
      .markdown?.getMarkdown() ?? "";
    if (value !== current) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;

    const refreshEditorMenus = () => {
      const next = getSlashMenuState(editor, slashMenuRef.current?.index ?? 0);
      setSlashMenu(next);
      setSelectionMenu(getSelectionMenuState(editor));
      setImageMenu(getImageMenuState(editor));
    };

    editor.on("update", refreshEditorMenus);
    editor.on("selectionUpdate", refreshEditorMenus);
    return () => {
      editor.off("update", refreshEditorMenus);
      editor.off("selectionUpdate", refreshEditorMenus);
    };
  }, [editor]);

  useEffect(() => {
    const close = () => {
      setTableMenu(null);
      setTableToolsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  if (!editor) return null;

  return (
    <div className="relative">
      <EditorToolbar editor={editor} />
      {selectionMenu && (
        <InlineFormatMenu
          editor={editor}
          style={{ left: selectionMenu.x, top: selectionMenu.y }}
        />
      )}
      {imageMenu && (
        <ImageActionMenu
          editor={editor}
          style={{ left: imageMenu.x, top: imageMenu.y }}
        />
      )}
      {editor.isActive("table") && (
        <div className="pointer-events-none sticky top-14 z-20 flex justify-end">
          <div className="pointer-events-auto -mb-9 mr-2 flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-md backdrop-blur">
            <button
              type="button"
              title="删除表格"
              onClick={() => runTableCommand(editor, "deleteTable")}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="更多表格操作"
              onClick={(event) => {
                event.stopPropagation();
                setTableToolsOpen((open) => !open);
              }}
              className={cn(
                "rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                tableToolsOpen && "bg-accent text-accent-foreground"
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {tableToolsOpen && editor.isActive("table") && (
        <TableActionMenu
          editor={editor}
          className="absolute right-2 top-24 z-30"
          onDone={() => setTableToolsOpen(false)}
        />
      )}
      <EditorContent editor={editor} />
      {tableMenu && (
        <TableActionMenu
          editor={editor}
          className="fixed z-50"
          style={{
            left: tableMenu.x,
            maxHeight: tableMenu.maxHeight,
            ...(tableMenu.placement === "top"
              ? { bottom: tableMenu.bottom }
              : { top: tableMenu.y }),
          }}
          onDone={() => setTableMenu(null)}
        />
      )}
      {slashMenu && visibleSlashCommands.length > 0 && (
        <SlashCommandMenu
          commands={visibleSlashCommands}
          activeIndex={Math.min(slashMenu.index, visibleSlashCommands.length - 1)}
          style={{
            left: slashMenu.x,
            maxHeight: slashMenu.maxHeight,
            ...(slashMenu.placement === "top"
              ? { bottom: slashMenu.bottom }
              : { top: slashMenu.y }),
          }}
          placement={slashMenu.placement}
          onSelect={(command) => {
            runSlashCommand(editor, slashMenu, command);
            setSlashMenu(null);
          }}
        />
      )}
    </div>
  );
}

export type { Editor };

function TableActionMenu({
  editor,
  className,
  style,
  onDone,
}: {
  editor: Editor;
  className?: string;
  style?: CSSProperties;
  onDone: () => void;
}) {
  const actions = [
    {
      label: "左侧插入列",
      icon: CornerLeftDown,
      action: "addColumnBefore" as const,
    },
    {
      label: "右侧插入列",
      icon: CornerRightDown,
      action: "addColumnAfter" as const,
    },
    {
      label: "上方插入行",
      icon: CornerDownLeft,
      action: "addRowBefore" as const,
    },
    {
      label: "下方插入行",
      icon: CornerDownRight,
      action: "addRowAfter" as const,
    },
  ];

  const destructive = [
    { label: "删除当前列", action: "deleteColumn" as const },
    { label: "删除当前行", action: "deleteRow" as const },
    { label: "删除表格", action: "deleteTable" as const },
  ];

  return (
    <div
      style={style}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "w-48 overflow-y-auto rounded-lg border border-border bg-background p-1.5 text-sm shadow-xl",
        className
      )}
    >
      {actions.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => {
            runTableCommand(editor, item.action);
            onDone();
          }}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <item.icon className="h-4 w-4 text-muted-foreground" />
          {item.label}
        </button>
      ))}
      <div className="my-1 border-t border-border" />
      {destructive.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => {
            runTableCommand(editor, item.action);
            onDone();
          }}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          <Trash2 className="h-4 w-4" />
          {item.label}
        </button>
      ))}
    </div>
  );
}

type TableCommand =
  | "addColumnBefore"
  | "addColumnAfter"
  | "addRowBefore"
  | "addRowAfter"
  | "deleteColumn"
  | "deleteRow"
  | "deleteTable";

function runTableCommand(editor: Editor, command: TableCommand) {
  const chain = editor.chain().focus();
  chain[command]().run();
}

function InlineFormatMenu({
  editor,
  style,
}: {
  editor: Editor;
  style: CSSProperties;
}) {
  const items = [
    {
      label: "加粗",
      icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      icon: Italic,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "链接",
      icon: LinkIcon,
      active: editor.isActive("link"),
      run: () => {
        const previous = editor.getAttributes("link").href as string | undefined;
        const url = window.prompt("输入链接地址", previous ?? "");
        if (url === null) return;
        if (!url.trim()) {
          editor.chain().focus().unsetLink().run();
          return;
        }
        editor.chain().focus().setLink({ href: url.trim() }).run();
      },
    },
    {
      label: "引用",
      icon: Quote,
      active: editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "二级标题",
      icon: Heading2,
      active: editor.isActive("heading", { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
  ];

  return (
    <div
      style={style}
      className="fixed z-50 flex items-center gap-1 rounded-lg border border-border bg-background p-1 shadow-xl"
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          title={item.label}
          onClick={item.run}
          className={cn(
            "rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            item.active && "bg-accent text-accent-foreground"
          )}
        >
          <item.icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

function ImageActionMenu({
  editor,
  style,
}: {
  editor: Editor;
  style: CSSProperties;
}) {
  return (
    <div
      style={style}
      className="fixed z-50 flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-xl backdrop-blur"
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        title="替换图片地址"
        onClick={() => {
          const previous = editor.getAttributes("image").src as string | undefined;
          const url = window.prompt("输入新的图片地址", previous ?? "");
          if (url?.trim()) {
            editor.chain().focus().updateAttributes("image", { src: url.trim() }).run();
          }
        }}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <ImageIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="删除图片"
        onClick={() => editor.chain().focus().deleteSelection().run()}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function SlashCommandMenu({
  commands,
  activeIndex,
  style,
  placement,
  onSelect,
}: {
  commands: EditorSlashCommand[];
  activeIndex: number;
  style: CSSProperties;
  placement: "top" | "bottom";
  onSelect: (command: EditorSlashCommand) => void;
}) {
  return (
    <div
      style={style}
      className={cn(
        "fixed z-50 w-64 overflow-y-auto rounded-xl border border-border bg-background p-1.5 text-sm shadow-xl",
        placement === "top" && "origin-bottom",
        placement === "bottom" && "origin-top"
      )}
    >
      <div className="px-2 py-1 text-xs text-muted-foreground">
        快速插入
      </div>
      {commands.map((command, index) => (
        <button
          key={command.label}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(command);
          }}
          className={cn(
            "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent",
            index === activeIndex && "bg-accent"
          )}
        >
          <command.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">
              {command.label}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {command.description}
            </span>
          </span>
        </button>
      ))}
      <div className="mt-1 border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
        ↑↓ 选择 · Enter 插入 · Esc 关闭
      </div>
    </div>
  );
}

function getSlashMenuState(editor: Editor, index: number): SlashMenuState {
  const { state, view } = editor;
  const { selection } = state;
  if (!selection.empty) return null;

  const { $from } = selection;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
  const match = /(?:^|\s)\/([\p{Letter}\p{Number}_-]*)$/u.exec(textBefore);
  if (!match) return null;

  const slashText = match[0];
  const leadingSpace = slashText.startsWith(" ") ? 1 : 0;
  const query = match[1] ?? "";
  const from = selection.from - slashText.length + leadingSpace;
  const coords = view.coordsAtPos(selection.from);
  const position = getAnchoredMenuPosition({
    top: coords.top,
    bottom: coords.bottom,
    idealHeight: 430,
    minHeight: 180,
    gap: 8,
  });

  return {
    query,
    index,
    from,
    to: selection.from,
    x: Math.min(coords.left, window.innerWidth - 280),
    ...position,
  };
}

function getAnchoredMenuPosition({
  top,
  bottom,
  idealHeight,
  minHeight,
  gap,
}: {
  top: number;
  bottom: number;
  idealHeight: number;
  minHeight: number;
  gap: number;
}): {
  y?: number;
  bottom?: number;
  maxHeight: number;
  placement: "top" | "bottom";
} {
  const viewportPadding = 8;
  const spaceBelow = window.innerHeight - bottom - gap - viewportPadding;
  const spaceAbove = top - gap - viewportPadding;
  const placement =
    spaceBelow < Math.min(idealHeight, 320) && spaceAbove > spaceBelow
      ? "top"
      : "bottom";
  const maxHeight =
    placement === "top"
      ? Math.max(minHeight, Math.min(idealHeight, spaceAbove))
      : Math.max(minHeight, Math.min(idealHeight, spaceBelow));

  return placement === "top"
    ? {
        placement,
        maxHeight,
        bottom: Math.max(viewportPadding, window.innerHeight - top + gap),
      }
    : {
        placement,
        maxHeight,
        y: Math.min(bottom + gap, window.innerHeight - maxHeight - viewportPadding),
      };
}

function getSelectionMenuState(editor: Editor): SelectionMenuState {
  const { state, view } = editor;
  const { selection } = state;
  if (
    selection.empty ||
    editor.isActive("codeBlock") ||
    editor.isActive("table") ||
    editor.isActive("image")
  ) {
    return null;
  }

  const fromCoords = view.coordsAtPos(selection.from);
  const toCoords = view.coordsAtPos(selection.to);
  const x = Math.min(
    Math.max(8, (fromCoords.left + toCoords.right) / 2 - 92),
    window.innerWidth - 220
  );
  const y = Math.max(8, Math.min(fromCoords.top - 46, window.innerHeight - 64));
  return { x, y };
}

function getVisibleSlashCommands(
  commands: EditorSlashCommand[],
  query: string
): EditorSlashCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return commands;
  return commands.filter(
    (command) =>
      command.label.toLowerCase().includes(normalized) ||
      command.aliases.some((alias) => alias.toLowerCase().includes(normalized))
  );
}

function runSlashCommand(
  editor: Editor,
  menu: NonNullable<SlashMenuState>,
  command: EditorSlashCommand
) {
  editor.chain().focus().deleteRange({ from: menu.from, to: menu.to }).run();
  command.run(editor);
}

function normalizePastedMarkdownTables(text: string): string {
  const lines = text.split(/\r?\n/);
  const normalized: string[] = [];
  let index = 0;

  while (index < lines.length) {
    if (isMarkdownTableStart(lines, index)) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      normalized.push(...normalizeMarkdownTable(tableLines));
      continue;
    }
    normalized.push(lines[index]);
    index += 1;
  }

  return normalized.join("\n");
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  const current = lines[index]?.trim() ?? "";
  const next = lines[index + 1]?.trim() ?? "";
  return (
    current.startsWith("|") &&
    current.endsWith("|") &&
    /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next)
  );
}

function normalizeMarkdownTable(lines: string[]): string[] {
  const rows = lines
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.replace(/\s+/g, " ").trim())
    )
    .filter((cells) => cells.length > 0);
  if (rows.length < 2) return lines;

  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ""),
  ]);
  const divider = padded[1].map(() => "---");
  return padded.map((row, rowIndex) => {
    const cells = rowIndex === 1 ? divider : row;
    return `| ${cells.join(" | ")} |`;
  });
}
