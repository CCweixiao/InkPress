# 素材块 P2（编辑器集成：SnippetInsertPanel + 拖拽插入 + 摘录）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在文章编辑器加「灵感」面板（AIPanel 第 3 个 tab），支持点击插光标 / 拖拽插指定位置（按 kind 映射 Markdown），并在编辑器工具栏加「保存选区为灵感」摘录按钮。

**Architecture:** 一次性把 TipTap editor 实例从 TiptapEditor 提到 EditorWorkspace（`onEditorReady` 回调，纯加法），暴露 `insertMarkdown(md)` / `getSelectionText()`；面板点击走 editor 句柄光标插入，拖拽走新 `SnippetDrop` ProseMirror 扩展（镜像 `ImageUpload.ts`）读 `application/x-snippet` 载荷 → `insertContentAt`。`snippetToMarkdown` 纯函数按 kind 映射 Markdown，TDD 覆盖；其余组件/编辑器接线靠 typecheck + build + 手动验证。

**Tech Stack:** Next.js App Router · React · TypeScript · TipTap (`@tiptap/react`/`core`/`pm/state`) + `tiptap-markdown` · vitest (`tests/unit/`).

## Global Constraints

- **TDD 边界**：仅 `snippetToMarkdown` 纯函数写单测（Task 1）。组件 / TipTap 扩展 / 编辑器接线不写单测，靠 typecheck + build + 手动验证清单。
- **不自行 commit 的例外**：本会话用户已授权 per-task commit（延续 P1/Gap 轮）。每个任务结束 typecheck 绿后 commit，**不 push**。stage 时只 `git add` 本任务改动的具体文件，**禁用 `git add -A`**（Task 4 of P1 曾误带入无关文件）。
- **behavior-preserving 既有链路**：TiptapEditor 的 `value`/`onChange` 字符串边界、`createImageUploadExtension` 不改；`onEditorReady` 与 `createSnippetDropExtension` 都是纯加法。
- **拖拽 mime 互斥**：`application/x-snippet`（本功能）vs `image/*`（ImageUpload）。SnippetDrop 只认自己的 mime，其余 return false。
- **无 toast 库**：摘录反馈用内联 `savedMsg` state + `setTimeout` 2s（mirror `ArticleMaterialsPanel` 的 `copied` 模式）。
- **面板只读**：SnippetInsertPanel 只列 + 插入，不做创建/编辑/删除/pin（那些在 `/snippets` 页）。
- **spec 路径**：`docs/superpowers/specs/2026-07-07-snippets-p2-editor-integration-design.md`（权威，冲突时以 spec 为准）。

---

## File Structure

| 文件 | 责任 | 任务 |
|---|---|---|
| `src/lib/ai/snippet-markdown.ts`（新） | `snippetToMarkdown(s) → string` 按 kind 映射 Markdown | Task 1（TDD）|
| `tests/unit/snippet-markdown.test.ts`（新） | 4 kind + 边界单测 | Task 1 |
| `src/components/editor/extensions/SnippetDrop.ts`（新） | TipTap drop 扩展，读 `application/x-snippet` → `insertContentAt` | Task 2 |
| `src/components/editor/TiptapEditor.tsx`（改） | 加 `onEditorReady` prop + useEffect；extensions 注册 `createSnippetDropExtension()` | Task 3 |
| `src/components/editor/SnippetInsertPanel.tsx`（新） | 灵感面板：搜索 + 卡片（点击插入 + draggable） | Task 4 |
| `src/components/editor/AIPanel.tsx`（改） | `AIPanelMode` 加 `"snippets"`；加「灵感」tab；`onInsertMarkdown` prop；渲染面板 | Task 5 |
| `src/components/editor/EditorWorkspace.tsx`（改） | editorRef + `insertMarkdown`/`getSelectionText`；`onEditorReady` 下传；`onInsertMarkdown` 下传；aside 标题；摘录按钮 | Task 6 / Task 7 |
| `tests/unit/project-index.test.ts`（既有，预存失败） | CodeGraphCache 表缺失（与本计划无关，忽略） | — |

---

## Task 1: snippet-markdown.ts — 按 kind 映射 Markdown（TDD）

**Files:**
- Create: `src/lib/ai/snippet-markdown.ts`
- Test: `tests/unit/snippet-markdown.test.ts`

**Interfaces:**
- Produces: `snippetToMarkdown(s: SnippetLike): string`、类型 `SnippetLike`。Task 2（SnippetDrop）与 Task 4（panel）消费。

- [ ] **Step 1: 写失败测试** `tests/unit/snippet-markdown.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { snippetToMarkdown } from "../../src/lib/ai/snippet-markdown";

describe("snippetToMarkdown", () => {
  it("text → content 原样", () => {
    expect(snippetToMarkdown({ kind: "text", content: "一段灵感" })).toBe("一段灵感");
  });

  it("quote + source → blockquote 含出处", () => {
    expect(
      snippetToMarkdown({ kind: "quote", content: "减法", quoteSource: "张小龙" })
    ).toBe('> "减法"\n>\n> —— 张小龙');
  });

  it("quote 无 source → 简单 blockquote", () => {
    expect(snippetToMarkdown({ kind: "quote", content: "减法" })).toBe('> "减法"');
  });

  it("image + content → 图片后接配文", () => {
    expect(
      snippetToMarkdown({
        kind: "image",
        content: "配文",
        imageUrl: "http://x/a.png",
        title: "图",
      })
    ).toBe("![图](http://x/a.png)\n配文");
  });

  it("image 无 content → 仅图片行（title 缺省为「图」）", () => {
    expect(
      snippetToMarkdown({ kind: "image", content: "", imageUrl: "http://x/a.png" })
    ).toBe("![图](http://x/a.png)");
  });

  it("link + content → 链接带备注", () => {
    expect(
      snippetToMarkdown({
        kind: "link",
        content: "备注",
        linkUrl: "http://x",
        linkTitle: "标题",
      })
    ).toBe("[标题](http://x) — 备注");
  });

  it("link 无 linkTitle → 用 url 作文本", () => {
    expect(
      snippetToMarkdown({ kind: "link", content: "", linkUrl: "http://x" })
    ).toBe("[http://x](http://x)");
  });

  it("未知 kind → 兜底按 text", () => {
    expect(snippetToMarkdown({ kind: "weird", content: "x" })).toBe("x");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/unit/snippet-markdown.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/ai/snippet-markdown'`

- [ ] **Step 3: 写最小实现** `src/lib/ai/snippet-markdown.ts`

```ts
/**
 * 按 kind 把素材映射成插入编辑器的 Markdown（对齐设计文档 §5.4）。
 * 纯函数，不依赖 React / editor —— 面板点击与 SnippetDrop 插件共用，便于单测。
 */
export type SnippetLike = {
  kind: string;
  content: string;
  title?: string;
  imageUrl?: string | null;
  quoteSource?: string | null;
  linkUrl?: string | null;
  linkTitle?: string | null;
};

export function snippetToMarkdown(s: SnippetLike): string {
  switch (s.kind) {
    case "quote": {
      return s.quoteSource
        ? `> "${s.content}"\n>\n> —— ${s.quoteSource}`
        : `> "${s.content}"`;
    }
    case "image": {
      const alt = s.title || "图";
      const img = s.imageUrl ? `![${alt}](${s.imageUrl})` : "";
      return s.content ? `${img}\n${s.content}` : img;
    }
    case "link": {
      const url = s.linkUrl || "";
      const text = s.linkTitle || url;
      const link = url ? `[${text}](${url})` : text;
      return s.content ? `${link} — ${s.content}` : link;
    }
    case "text":
    default:
      return s.content;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/unit/snippet-markdown.test.ts`
Expected: PASS（8/8）

- [ ] **Step 5: Checkpoint + commit**

Run: `pnpm typecheck` → 通过。
```bash
git add src/lib/ai/snippet-markdown.ts tests/unit/snippet-markdown.test.ts
git commit -m "feat(snippets): add snippetToMarkdown pure fn + tests (P2)"
```

---

## Task 2: SnippetDrop TipTap 扩展（拖拽插入，item 13）

**Files:**
- Create: `src/components/editor/extensions/SnippetDrop.ts`

**Interfaces:**
- Consumes: `snippetToMarkdown` + `SnippetLike`（Task 1）；TipTap `Extension`/`Plugin`/`PluginKey`（与 `ImageUpload.ts` 同款 import）。
- Produces: `createSnippetDropExtension(): Extension`。Task 3 注册进 TiptapEditor。

- [ ] **Step 1: 创建 `src/components/editor/extensions/SnippetDrop.ts`**

镜像 `extensions/ImageUpload.ts` 的 ProseMirror 插件结构。完整代码：

```ts
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { snippetToMarkdown, type SnippetLike } from "@/lib/ai/snippet-markdown";

const SNIPPET_MIME = "application/x-snippet";

/**
 * 拖拽灵感素材插入编辑区。
 * 面板卡片 onDragStart 写 application/x-snippet 载荷（JSON），此扩展 handleDrop
 * 读载荷 → snippetToMarkdown → insertContentAt(dropPos, md)（tiptap-markdown 解析为富文本）。
 * 非 snippet 载荷（图片文件 / 外部文本）→ return false，让 ImageUpload / TipTap 默认处理。
 */
export function createSnippetDropExtension() {
  return Extension.create({
    name: "snippetDrop",

    addProseMirrorPlugins() {
      const editor = this.editor as Editor;
      return [
        new Plugin({
          key: new PluginKey("snippetDrop"),
          props: {
            handleDrop(view, event) {
              const dt = event.dataTransfer;
              if (!dt) return false;
              const raw = dt.getData(SNIPPET_MIME);
              if (!raw) return false;
              let snippet: SnippetLike;
              try {
                snippet = JSON.parse(raw) as SnippetLike;
              } catch {
                return false;
              }
              event.preventDefault();
              const coords = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              const pos = coords?.pos ?? view.state.selection.from;
              editor.commands.insertContentAt(pos, snippetToMarkdown(snippet));
              return true;
            },
          },
        }),
      ];
    },
  });
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 通过（SnippetDrop 未被 import 也合法，孤立模块）。

- [ ] **Step 3: commit**

```bash
git add src/components/editor/extensions/SnippetDrop.ts
git commit -m "feat(snippets): add SnippetDrop TipTap extension (P2 drag-drop)"
```

---

## Task 3: TiptapEditor — onEditorReady + 注册 SnippetDrop

**Files:**
- Modify: `src/components/editor/TiptapEditor.tsx`

**Interfaces:**
- Consumes: `createSnippetDropExtension`（Task 2）。
- Produces: TiptapEditor 加 `onEditorReady?: (editor: Editor) => void` prop；editor 创建后回调一次。Task 6（EditorWorkspace）消费这个句柄。

- [ ] **Step 1: 加 import**

在 `src/components/editor/TiptapEditor.tsx` 顶部 import 区，紧挨 `createImageUploadExtension` 的 import（L41）加：

```ts
import { createSnippetDropExtension } from "./extensions/SnippetDrop";
```

并确认 `Editor` 类型与 `useEffect` 已 import（若 `useEffect` 未 import 则补；`Editor` 类型从 `@tiptap/react` import）。

- [ ] **Step 2: 加 onEditorReady prop**

找到 TiptapEditor 的 props 解构（`export function TiptapEditor({ … }: { … }`），在 props 列表与对应类型里加 `onEditorReady`。例如若 props 类型是内联对象，加一行：

```ts
  /** editor 实例就绪后回调一次（供父级做光标精确插入 / 选区读取）。 */
  onEditorReady?: (editor: Editor) => void;
```

并在解构参数里加上 `onEditorReady,`。

- [ ] **Step 3: extensions 数组注册 SnippetDrop**

在 `useEditor({ extensions: [ … ], … })`（L255-287）的 extensions 数组里，紧挨 `createImageUploadExtension(articleId),`（L286）之后加一行：

```ts
      createSnippetDropExtension(),
```

- [ ] **Step 4: editor 就绪回调**

在 `const editor = useEditor({ … });` 之后加一个 useEffect（`editor` 可能为 null，需判空）：

```ts
  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);
```

- [ ] **Step 5: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 通过。

- [ ] **Step 6: commit**

```bash
git add src/components/editor/TiptapEditor.tsx
git commit -m "feat(editor): TiptapEditor onEditorReady + register SnippetDrop (P2)"
```

---

## Task 4: SnippetInsertPanel — 灵感面板组件（item 12）

**Files:**
- Create: `src/components/editor/SnippetInsertPanel.tsx`

**Interfaces:**
- Consumes: `snippetToMarkdown`（Task 1）；`SnippetItem`（`@/components/snippets/types`）；`/api/snippets` GET（full SnippetItem）。
- Produces: `<SnippetInsertPanel onInsertMarkdown={(md)=>…} />`。Task 5（AIPanel）渲染。

> 注：spec §5 写了 `articleId` prop，但面板列全部素材（snippet 非文章级），articleId 无用 → 本计划去掉（YAGNI）。若后续要按来源文章筛再加。

- [ ] **Step 1: 创建 `src/components/editor/SnippetInsertPanel.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  Search,
  Image as ImageIcon,
  Quote,
  Link as LinkIcon,
} from "lucide-react";
import { snippetToMarkdown } from "@/lib/ai/snippet-markdown";
import type { SnippetItem } from "@/components/snippets/types";

interface SnippetInsertPanelProps {
  onInsertMarkdown: (md: string) => void;
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === "image") return <ImageIcon className="h-3 w-3 text-muted-foreground" />;
  if (kind === "quote") return <Quote className="h-3 w-3 text-muted-foreground" />;
  if (kind === "link") return <LinkIcon className="h-3 w-3 text-muted-foreground" />;
  return null;
}

/** 把 SnippetItem（tagsJson 是字符串）转成 snippetToMarkdown 需要的形状。 */
function toMarkdown(s: SnippetItem): string {
  return snippetToMarkdown({
    kind: s.kind,
    content: s.content,
    title: s.title,
    imageUrl: s.imageUrl,
    quoteSource: s.quoteSource,
    linkUrl: s.linkUrl,
    linkTitle: s.linkTitle,
  });
}

/** 面板卡片 onDragStart 写的载荷（与 SnippetDrop 插件读的 mime 对齐）。 */
function toDragPayload(s: SnippetItem): string {
  return JSON.stringify({
    kind: s.kind,
    content: s.content,
    title: s.title,
    imageUrl: s.imageUrl,
    quoteSource: s.quoteSource,
    linkUrl: s.linkUrl,
    linkTitle: s.linkTitle,
  });
}

function parseTags(tagsJson: string): string[] {
  try {
    return JSON.parse(tagsJson || "[]");
  } catch {
    return [];
  }
}

export function SnippetInsertPanel({ onInsertMarkdown }: SnippetInsertPanelProps) {
  const [items, setItems] = useState<SnippetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SnippetItem[] | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/snippets?limit=100");
      const data = (await res.json().catch(() => ({}))) as { snippets?: SnippetItem[] };
      setItems(data.snippets ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/snippets?q=${encodeURIComponent(q)}&limit=100`);
        const data = (await res.json().catch(() => ({}))) as { snippets?: SnippetItem[] };
        setSearchResults(data.snippets ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const list = searchResults ?? items;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索灵感…"
          className="w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {loading && (
        <div className="py-4 text-center text-xs text-muted-foreground">加载中…</div>
      )}
      {!loading && error && (
        <div className="py-4 text-center text-xs text-muted-foreground">
          加载失败，
          <button type="button" className="text-primary underline" onClick={refresh}>
            重试
          </button>
        </div>
      )}
      {!loading && !error && list.length === 0 && (
        <div className="py-4 text-center text-xs text-muted-foreground">
          {query ? "未找到匹配的灵感" : "还没有灵感，去 /snippets 创建"}
        </div>
      )}
      {!loading &&
        !error &&
        list.map((s) => {
          const tags = parseTags(s.tagsJson);
          return (
            <div
              key={s.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("application/x-snippet", toDragPayload(s))}
              onClick={() => onInsertMarkdown(toMarkdown(s))}
              className="group cursor-pointer rounded-md border border-border bg-background p-2 transition-all hover:border-primary/40 hover:shadow-sm"
              title="点击插入到光标处，或拖拽到正文指定位置"
            >
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 shrink-0 text-primary" />
                <KindIcon kind={s.kind} />
                <span className="truncate text-xs font-medium">
                  {s.title || s.content.slice(0, 24)}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                {s.content}
              </p>
              {tags.length > 0 && (
                <span className="mt-0.5 block truncate text-[10px] text-primary/70">
                  #{tags[0]}
                </span>
              )}
            </div>
          );
        })}
      {searching && <div className="text-[10px] text-muted-foreground">搜索中…</div>}
    </div>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `pnpm typecheck && pnpm lint src/components/editor/SnippetInsertPanel.tsx`
Expected: typecheck 通过；lint 对该文件 0 error。

- [ ] **Step 3: commit**

```bash
git add src/components/editor/SnippetInsertPanel.tsx
git commit -m "feat(snippets): add SnippetInsertPanel (P2 editor panel)"
```

---

## Task 5: AIPanel — 加「灵感」tab + onInsertMarkdown prop

**Files:**
- Modify: `src/components/editor/AIPanel.tsx`

**Interfaces:**
- Consumes: `SnippetInsertPanel`（Task 4）。
- Produces: `AIPanelMode` 加 `"snippets"`；AIPanel 接受 `onInsertMarkdown?: (md: string) => void`。Task 6（EditorWorkspace）传入。

- [ ] **Step 1: 改 AIPanelMode + import**

L9：
```ts
export type AIPanelMode = "chat" | "materials" | "snippets";
```
顶部 import 加 `Sparkles`（lucide）与 SnippetInsertPanel：
```ts
import { Bot, FolderOpen, Sparkles } from "lucide-react";
import { SnippetInsertPanel } from "./SnippetInsertPanel";
```

- [ ] **Step 2: 加 onInsertMarkdown prop**

在 AIPanel 的 props 解构（L11-43）加 `onInsertMarkdown`，并加到类型：
```ts
  onInsertMarkdown?: (md: string) => void;
```
解构参数加 `onInsertMarkdown,`。

- [ ] **Step 3: 加「灵感」tab 按钮**

在 tab 容器（L54-75 的 `<div className="flex gap-1 rounded-md bg-muted p-1">`）里，在「素材」button 之后追加第 3 个 button：
```tsx
          <button
            onClick={() => setMode("snippets")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded py-1.5 text-xs font-medium transition-colors",
              mode === "snippets" ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            灵感
          </button>
```

- [ ] **Step 4: 渲染 SnippetInsertPanel**

在 `{mode === "materials" && ( … )}` 块（L92-101）之后追加：
```tsx
      {mode === "snippets" && (
        <div className="flex-1 overflow-y-auto p-3">
          <SnippetInsertPanel onInsertMarkdown={onInsertMarkdown ?? (() => {})} />
        </div>
      )}
```
> `onInsertMarkdown ?? (() => {})` 兜底：AIPanel 可能在 EditorWorkspace 传句柄前渲染（极少），避免 undefined 调用。

- [ ] **Step 5: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 通过。

- [ ] **Step 6: commit**

```bash
git add src/components/editor/AIPanel.tsx
git commit -m "feat(editor): AIPanel add snippets tab + onInsertMarkdown prop (P2)"
```

---

## Task 6: EditorWorkspace — 提 editor 句柄 + 下传 + aside 标题

**Files:**
- Modify: `src/components/editor/EditorWorkspace.tsx`

**Interfaces:**
- Consumes: TiptapEditor 的 `onEditorReady`（Task 3）；AIPanel 的 `onInsertMarkdown`（Task 5）；`@tiptap/react` 的 `Editor` 类型。
- Produces: `insertMarkdown(md)` / `getSelectionText()`（Task 7 摘录按钮消费 getSelectionText；AIPanel→面板消费 insertMarkdown）。

- [ ] **Step 1: 加 import + state/ref**

顶部 import 确保含 `useRef`、`useCallback`（若未 import 则补）与 `Editor` 类型：
```ts
import type { Editor } from "@tiptap/react";
```
（`useRef`/`useCallback` 已在项目中大量使用，按 typecheck 提示补。）

在 EditorWorkspace 组件体内（与其他 useState/ref 同区域）加：
```ts
  const editorRef = useRef<Editor | null>(null);

  /** 光标处插入 Markdown（面板点击用；tiptap-markdown 解析为富文本）。 */
  const insertMarkdown = useCallback((md: string) => {
    editorRef.current?.chain().focus().insertContent(md).run();
  }, []);

  /** 读当前选区文本（摘录用；空选区返回 ""）。 */
  const getSelectionText = useCallback(() => {
    const e = editorRef.current;
    if (!e) return "";
    const { from, to } = e.state.selection;
    return e.state.doc.textBetween(from, to, "\n").trim();
  }, []);
```

- [ ] **Step 2: 传 onEditorReady 给 TiptapEditor**

找到 `<TiptapEditor … />` 渲染（L484 附近），加一个 prop：
```tsx
        onEditorReady={(e) => {
          editorRef.current = e;
        }}
```

- [ ] **Step 3: 传 onInsertMarkdown 给 AIPanel**

找到 `<AIPanel … />` 渲染（L345-360），在 props 里加：
```tsx
          onInsertMarkdown={insertMarkdown}
```

- [ ] **Step 4: aside 标题/描述兼容 snippets**

aside header（L332-344）的标题与描述用 `aiMode` 判断，更新为三分支：
```tsx
            <h2 className="text-sm font-semibold">
              {aiMode === "chat" ? "写作助手" : aiMode === "snippets" ? "灵感" : "素材"}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            {aiMode === "chat"
              ? "研究、分析、创作并通过提案安全调整文章"
              : aiMode === "snippets"
                ? "点击或拖拽灵感素材插入正文"
                : "上传与管理本文素材，可插入正文"}
          </p>
```
> 布局逻辑（L324-330 `aiMode === "chat" ? wide : w-72`）无需改——snippets 落到 w-72 分支，与 materials 一致。

- [ ] **Step 5: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 通过。

- [ ] **Step 6: 手动验证（清单 A + B）**

`pnpm dev`（dev server 应已在跑；DB 已 migrate）。浏览器：
- [ ] 左 aside 出现第 3 个「灵感」tab，点击切换；标题/描述变「灵感」/「点击或拖拽…」
- [ ] 面板列出素材（先在 /snippets 建几条不同 kind）
- [ ] 搜索框过滤
- [ ] **光标精确插入**：编辑器光标放段落中间 → 点面板卡片 → 内容插在光标处（不是末尾）；text/quote/image/link 各试一种

- [ ] **Step 7: commit**

```bash
git add src/components/editor/EditorWorkspace.tsx
git commit -m "feat(editor): lift editor handle to EditorWorkspace + wire insertMarkdown (P2)"
```

---

## Task 7: 摘录工具栏按钮（item 14）

**Files:**
- Modify: `src/components/editor/EditorWorkspace.tsx`

**Interfaces:**
- Consumes: `getSelectionText()`（Task 6）；`articleId`（EditorWorkspace 已有）；`/api/snippets` POST。

- [ ] **Step 1: 加 state + handler**

在 EditorWorkspace 组件体内（Task 6 加的 getSelectionText 附近）加：
```ts
  const [excerptMsg, setExcerptMsg] = useState<string | null>(null);

  async function handleExcerpt() {
    const text = getSelectionText();
    if (!text) {
      setExcerptMsg("请先选中文字");
      window.setTimeout(() => setExcerptMsg(null), 2000);
      return;
    }
    try {
      const res = await fetch("/api/snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          kind: "text",
          sourceArticleId: article.id,
        }),
      });
      setExcerptMsg(res.ok ? "✓ 已保存到灵感" : "保存失败");
    } catch {
      setExcerptMsg("保存失败");
    }
    window.setTimeout(() => setExcerptMsg(null), 2000);
  }
```
> 确认 `article` 是 EditorWorkspace 内文章对象（含 `.id`）；若变量名不同（如 `articleId` 已单独解构），用对应名。

- [ ] **Step 2: 工具栏加按钮 + 内联反馈**

找到编辑器顶部工具栏（L369 `<div className="px-6 py-3 border-b border-border flex items-center gap-3">`），在保存状态 `<span>`（L376-382）之后、Popover（L383）之前插入：
```tsx
          <Button
            variant="outline"
            size="sm"
            onClick={handleExcerpt}
            title="把当前选区文字保存为灵感素材"
            className="h-8 shrink-0"
          >
            保存选区为灵感
          </Button>
          {excerptMsg && (
            <span className="text-xs text-muted-foreground shrink-0">{excerptMsg}</span>
          )}
```
> 确认 `Button` 已 import（EditorWorkspace 已用 Button，应已 import）。

- [ ] **Step 3: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 通过。

- [ ] **Step 4: 手动验证（清单 C + D）**

浏览器：
- [ ] **拖拽**：从面板卡片拖到编辑器某位置 → 内容插在 drop 位置；拖图片文件进编辑器仍走 ImageUpload（不冲突）
- [ ] **摘录**：选中编辑器一段文字 → 点「保存选区为灵感」→ 内联「✓ 已保存到灵感」2s
- [ ] 不选中文字点按钮 → 内联「请先选中文字」2s
- [ ] 去 /snippets 看到新条目（kind=text，sourceArticleId 正确）

- [ ] **Step 5: commit**

```bash
git add src/components/editor/EditorWorkspace.tsx
git commit -m "feat(editor): excerpt toolbar button - save selection as snippet (P2)"
```

---

## Task 8: 全量构建 + 完整验证

**Files:** 无（验证 gate）

- [ ] **Step 1: 全套单测**

Run: `pnpm test`
Expected: 全绿 + Task 1 新增 8 个；仅 `project-index.test.ts` 2 个预存失败（CodeGraphCache，与本计划无关）。

- [ ] **Step 2: typecheck + build + lint**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: typecheck/build 通过；lint 0 error（新增文件的 warning 可接受）。

- [ ] **Step 3: 全量手动验证清单（spec §13 A-E）**

逐项跑（A 面板 / B 点击插入光标 / C 拖拽 / D 摘录 / E 构建）。任一项红 → 回对应 Task 修。

- [ ] **Step 4: 报告 + 等待提交/merge 指示**

报告全部改动文件 + 清单结果。**不 push**（push/merge 由用户拍板）。

---

## Self-Review 结果

**1. Spec 覆盖**：
- §1 目标①面板（item 12）→ Task 4 + Task 5 ✓
- §1 目标②点击插入光标 + 拖拽（item 13）→ Task 6（光标）+ Task 2/3（拖拽 drop 扩展）+ Task 4（卡片 draggable）✓
- §1 目标③摘录（item 14）→ Task 7 ✓
- §3 editor 句柄提升 → Task 3 + Task 6 ✓
- §4 snippetToMarkdown TDD → Task 1 ✓
- §5 面板（搜索/卡片/四态/draggable）→ Task 4 ✓
- §6 SnippetDrop 扩展 → Task 2 + Task 3（注册）✓
- §7 摘录（内联反馈，无 toast）→ Task 7 ✓
- §8 组件改动（TiptapEditor/AIPanel/EditorWorkspace）→ Task 3/5/6/7 ✓
- §10 边界（mime 互斥 / parse 失败 return false / debounce / 空选区提示）→ Task 2/4/7 ✓
- §11 风险缓解 → onEditorReady 纯加法 / mime 互斥 / SnippetLike 不依赖 Editor ✓
- §13 手动清单 → Task 6 Step 6（A+B）/ Task 7 Step 4（C+D）/ Task 8（E）✓

**2. Placeholder 扫描**：无 TBD/TODO。Task 6/7 的「确认变量名（article.id / Button import）」是给执行者的核对提示（文件里已有），非占位。

**3. 类型一致性**：
- `snippetToMarkdown(s: SnippetLike)` Task 1 定义 → Task 2（SnippetDrop）+ Task 4（panel 经 toMarkdown 包装）消费，签名一致 ✓
- `createSnippetDropExtension()` Task 2 定义 → Task 3 注册消费 ✓
- `onEditorReady?: (editor: Editor) => void` Task 3 定义 → Task 6 传入 ✓
- `onInsertMarkdown: (md: string) => void` Task 4 定义 → Task 5（AIPanel 透传）→ Task 6（EditorWorkspace 传入 insertMarkdown）✓
- `application/x-snippet` mime：Task 4（onDragStart setData）↔ Task 2（handleDrop getData）字节一致 ✓
- `AIPanelMode` 加 `"snippets"`（Task 5）→ EditorWorkspace 的 `aiMode`（若类型为 AIPanelMode）自动覆盖；header 三分支（Task 6）✓

**4. 范围**：单一可执行计划，8 任务，各自有可验证交付物。
