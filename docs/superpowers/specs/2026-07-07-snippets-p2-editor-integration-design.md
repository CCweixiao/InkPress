# 素材块 P2：编辑器直接集成（SnippetInsertPanel + 拖拽插入 + 摘录）

- **日期**：2026-07-07
- **范围**：P2 item 12（编辑器侧边栏 SnippetInsertPanel）+ 13（拖拽插入编辑区 + Markdown 映射）+ 14（从编辑器选中文字摘录为灵感）
- **TDD 边界**：仅 `snippetToMarkdown` 纯函数（vitest + `tests/unit/`）。组件层 / TipTap 扩展 / 编辑器接线靠 typecheck + build + 手动验证
- **插入机制**：提 TipTap editor 实例到 EditorWorkspace（光标精确插入），原生 HTML5 拖拽 + 新 drop 插件（位置精确 drop）
- **上游设计文档**：`docs/features/snippets-design.md` §5.4 / §10 P2
- **上一轮 spec**：`docs/superpowers/specs/2026-07-07-snippets-p1-at-mention-composer-design.md`（P1 已完成）

---

## 1. 目标与非目标

### 目标
1. **SnippetInsertPanel**（item 12）：在文章编辑器左侧 AIPanel 加第 3 个「灵感」tab，列出全部素材块，支持搜索。
2. **点击插入 + 拖拽插入**（item 13）：面板卡片点击 → 在**编辑器光标处**插入（按 kind 映射的 Markdown）；卡片可拖拽 → drop 到编辑器**指定位置**插入。
3. **摘录**（item 14）：编辑器顶部工具栏「保存选区为灵感」按钮 → 把当前选区文本零摩擦存为 `kind=text` 素材（带 sourceArticleId）。

### 非目标（本轮不做）
- **item 15** 标签颜色系统 / SnippetTag 独立表（下一轮）
- 选区浮动按钮（BubbleMenu）—— 本轮选工具栏按钮
- 面板内卡片重排、批量操作（P4）
- 把 `ArticleMaterialsPanel` 也改成光标插入（本轮只 snippets 用 editor 句柄；materials 可后续复用）
- 摘录时弹窗加 tag（零摩擦；标签留给 P3 原地编辑）

---

## 2. 背景与现状（Explore 确认）

### 2.1 编辑器布局（`src/components/editor/EditorWorkspace.tsx` L289-531）
三栏 flexbox：
- **左 aside**（AI/Materials）：`AIPanel`，内部 `mode: "chat" | "materials"` tab 切换（AIPanel.tsx L44-49，tab UI L54-75，`AIPanelMode` union L9）。
- **中 main**：标题输入 + `<TiptapEditor>`（L484）。
- **右 aside**：WeChat 预览。

**无独立「灵感面板」槽位** → SnippetInsertPanel = AIPanel 第 3 个 tab。

### 2.2 ArticleMaterialsPanel（最接近的先例，`src/components/editor/ArticleMaterialsPanel.tsx`）
- `onInsert(md: string) => void` prop（L40）。
- 现有插入 = **追加到文档末尾**（AIPanel.tsx L97-99：`onApply((currentMarkdown ? currentMarkdown+"\n" : "") + markdown)`），**非光标插入**。
- 拖拽仅支持「拖文件进面板上传」（onDrop L98-106），不支持「拖素材出面板到编辑器」。
- 点击插入按钮（L216-223）→ `insertAsset` → `onInsert(md)`。

### 2.3 TipTap（`src/components/editor/TiptapEditor.tsx`）
- 规范插入 API：`editor.chain().focus().insertContent(md).run()`（slash 命令用，L188-192 / L232-239）；`insertContentAt(pos, ...)`（ImageUpload.ts L66）。
- `tiptap-markdown` 扩展（L265-269，`transformCopiedText/transformPastedText: true`）→ md 字符串经 `insertContent` 会被解析为富文本。
- **editor 实例未暴露给兄弟组件**（useEditor 在 TiptapEditor L255 内部，无 ref/onEditorReady）—— 只有 `value`/`onChange` 字符串边界。**这是光标精确插入的核心阻塞**。
- 现有 drop 处理：`createImageUploadExtension`（extensions/ImageUpload.ts L13-45）注册 ProseMirror `handleDrop`/`handlePaste`，**仅处理 image/* 文件**，非图片 dataTransfer return false。

### 2.4 @dnd-kit
仅在 `src/components/settings/SystemConfigManager.tsx`（垂直排序）用，**编辑器不用**。拖拽进 TipTap 用**原生 HTML5 drag**（ProseMirror handleDrop 消费 dataTransfer）。

### 2.5 数据
`GET /api/snippets`（route.ts L9-41）返回 full `SnippetItem`（含 content/linkUrl/quoteSource/quoteSource/title 等映射所需字段）。`/api/snippets/search`（@-panel 用的精简字段）不够，面板用 full `/api/snippets`。

---

## 3. 架构：提 editor 句柄 + 三条插入路径

一次性把 editor 实例从 TiptapEditor 提到 EditorWorkspace（`onEditorReady` 回调，纯加法），三条插入路径共用同一个句柄：

```
TiptapEditor ──onEditorReady(editor)──► EditorWorkspace 持 editorRef
                                             │
                  ┌──────────────────────────┼──────────────────────────┐
                  ▼                           ▼                          ▼
          insertMarkdown(md)           getSelectionText()         SnippetDrop 扩展
          (useCallback, 闭包 editorRef)  (useCallback)             (注册进 TiptapEditor extensions)
                  │                           │                          │
                  ▼                           ▼                          ▼
        §5 面板点击插入               §7 摘录工具栏按钮                §6 拖拽 drop
        editor.chain().focus()        读 editor.state.selection        handleDrop:
        insertContent(md).run()       textBetween(from,to,"\n")        insertContentAt(dropPos, md)
```

editor 句柄接口（EditorWorkspace 暴露，下传 AIPanel / 工具栏）：
```ts
const insertMarkdown = useCallback((md: string) => {
  editorRef.current?.chain().focus().insertContent(md).run();
}, []);
const getSelectionText = useCallback(() => {
  const e = editorRef.current;
  if (!e) return "";
  const { from, to } = e.state.selection;
  return e.state.doc.textBetween(from, to, "\n").trim();
}, []);
```

---

## 4. 纯逻辑 `snippetToMarkdown`（TDD）

**文件**：`src/lib/ai/snippet-markdown.ts`

```ts
export type SnippetLike = {
  kind: string;
  content: string;
  title?: string;
  imageUrl?: string | null;
  quoteSource?: string | null;
  linkUrl?: string | null;
  linkTitle?: string | null;
};

/**
 * 按 kind 把素材映射成插入编辑器的 Markdown（对齐设计文档 §5.4）。
 * 纯函数，不依赖 React / editor —— 便于单测，面板点击与 drop 插件共用。
 */
export function snippetToMarkdown(s: SnippetLike): string;
```

映射规则：
| kind | 输出 |
|------|------|
| `text` | `s.content` |
| `quote` | 有 quoteSource：`> "${content}"\n>\n> —— ${quoteSource}`；无：`> "${content}"` |
| `image` | 有 content：`![${title \|\| "图"}](${imageUrl})\n${content}`；无：`![${title \|\| "图"}](${imageUrl})` |
| `link` | `[${linkTitle \|\| linkUrl}](${linkUrl})${content ? ` — ${content}` : ""}` |
| 未知 | 兜底按 `text`（返回 content） |

> 所有插入字符串尾部不带换行（由 editor 的 insertContent 上下文决定）；调用方如需换行在 md 后自行加。

**测试**（`tests/unit/snippet-markdown.test.ts`）：
- text → content 原样
- quote + source → blockquote 含 `—— source`
- quote 无 source → 只 `> "content"`
- image + content → `![](url)\ncontent`
- image 无 content → 只图片行
- link + content → `[title](url) — content`
- link 无 linkTitle → 用 linkUrl 做文本
- 未知 kind → 按 text 兜底

---

## 5. SnippetInsertPanel（item 12）

**文件**：`src/components/editor/SnippetInsertPanel.tsx`

```tsx
interface SnippetInsertPanelProps {
  articleId: string;
  onInsertMarkdown: (md: string) => void;
}
```

- **数据**：`GET /api/snippets?limit=100`（full SnippetItem）。复用 `SnippetItem` 类型（`src/components/snippets/types.ts`）。
- **搜索**：顶部 `<input type="search">`，debounce 200ms，`GET /api/snippets?q=...&limit=100`（对齐 SnippetsView 模式）。
- **卡片**（精简版，不复用 SnippetCard 以免引入 pin/delete 等无关操作）：
  - 显示：title（或 content 首行）+ kind 图标 + 首个 tag。
  - 点击卡片 → `onInsertMarkdown(snippetToMarkdown(snippet))`。
  - `draggable` + `onDragStart={(e) => e.dataTransfer.setData("application/x-snippet", JSON.stringify(snippet))}`。
- **四态**：loading / 空态（「还没有灵感，去 /snippets 创建」）/ 错误重试 / 列表。镜像 SnippetMentionPopover 的四态处理。
- **不负责**：创建/编辑/删除/pin（那是 /snippets 页面的事；面板只读 + 插入）。

---

## 6. SnippetDrop TipTap 扩展（item 13 拖拽）

**文件**：`src/components/editor/extensions/SnippetDrop.ts`

镜像 `extensions/ImageUpload.ts` 的 ProseMirror 插件模式：

```ts
export function createSnippetDropExtension() {
  // 返回一个 TipTap Extension，注册 ProseMirror plugin：
  // - handleDrop(view, pos, event): 读 event.dataTransfer.getData("application/x-snippet")
  //   - 有值 → JSON.parse → snippetToMarkdown → insertContentAt(dropPos, md) → return true
  //   - 无值 → return false（让 ImageUpload / TipTap 默认处理）
}
```

- 注册进 `TiptapEditor.tsx` extensions 数组（L256+，紧挨 `createImageUploadExtension(articleId)`）。
- 与 ImageUpload 互斥：各自认自己的 mime（`image/*` vs `application/x-snippet`）。
- 载荷 JSON.parse 失败 → return false（容错）。

---

## 7. 摘录工具栏按钮（item 14）

**位置**：`EditorWorkspace.tsx` 编辑器顶部工具栏（标题输入附近，L370 区域）。

```tsx
// 项目无 toast 库 → 用 ArticleMaterialsPanel 的 copied 模式：saved 状态 + setTimeout 2s 内联反馈
const [savedMsg, setSavedMsg] = useState<string | null>(null);

async function handleExcerpt() {
  const text = getSelectionText();
  if (!text) {
    setSavedMsg("请先选中文字");
    window.setTimeout(() => setSavedMsg(null), 2000);
    return;
  }
  const res = await fetch("/api/snippets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text, kind: "text", sourceArticleId: articleId }),
  });
  setSavedMsg(res.ok ? "✓ 已保存到灵感" : "保存失败");
  window.setTimeout(() => setSavedMsg(null), 2000);
}

<Button onClick={handleExcerpt}>保存选区为灵感</Button>
{savedMsg && <span className="text-xs text-muted-foreground">{savedMsg}</span>}
```

- 按钮始终可点（不实时订阅选区）；点击瞬间读 `editor.state.selection`。
- 空选区 → 内联「请先选中文字」2s。
- 有选区 → 零摩擦创建 `kind=text` + `sourceArticleId`（无弹窗、无 tag）；成功 → 内联「✓ 已保存到灵感」2s。

---

## 8. 组件改动汇总

| 文件 | 改动 |
|------|------|
| `TiptapEditor.tsx` | 加 `onEditorReady?: (editor: Editor) => void` prop；editor 创建后（useEffect）调一次；extensions 加 `createSnippetDropExtension()` |
| `EditorWorkspace.tsx` | 加 `editorRef` + `editorReady` state；传 `onEditorReady` 给 TiptapEditor；定义 `insertMarkdown` / `getSelectionText`；下传 AIPanel；加摘录工具栏按钮 |
| `AIPanel.tsx` | `AIPanelMode` union 加 `"snippets"`；tab UI 加「灵感」；mode=snippets 时渲染 `<SnippetInsertPanel articleId onInsertMarkdown={insertMarkdown} />`；接收 `insertMarkdown` prop 透传 |
| `SnippetInsertPanel.tsx`（新） | 见 §5 |
| `extensions/SnippetDrop.ts`（新） | 见 §6 |
| `snippet-markdown.ts`（新） | 见 §4 |

---

## 9. 数据流

**点击插入**：
```
面板卡片 click → onInsertMarkdown(snippetToMarkdown(s)) → EditorWorkspace.insertMarkdown
  → editor.chain().focus().insertContent(md).run() → tiptap-markdown 解析为富文本，插在光标处
```

**拖拽插入**：
```
面板卡片 dragstart → dataTransfer["application/x-snippet"] = JSON(s)
→ 拖到编辑器 → SnippetDrop.handleDrop 读 dataTransfer → snippetToMarkdown → insertContentAt(dropPos, md)
```

**摘录**：
```
编辑器选区 → 工具栏按钮 click → getSelectionText() → POST /api/snippets {content, kind:"text", sourceArticleId}
→ toast「已保存到灵感」
```

---

## 10. 边界与错误处理

| 场景 | 行为 |
|------|------|
| editor 句柄未就绪时点击插入 | `editorRef.current?.chain()...` 可选链，no-op（不崩）；面板按钮在 editorReady=false 时可禁用 |
| 拖拽非 snippet 载荷 | SnippetDrop return false，让 ImageUpload / 默认处理 |
| dataTransfer JSON parse 失败 | return false（容错，不崩） |
| 搜索 debounce | 200ms（对齐 SnippetsView） |
| 面板 API 失败 | 错误态 + 重试按钮 |
| 摘录空选区点击 | 内联「请先选中文字」2s |
| 摘录 API 失败 | 内联「保存失败」2s |
| 插入的 markdown 含特殊字符 | tiptap-markdown 自行解析；不做转义（内容来自用户自己的素材） |

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 提 editor 句柄动 TiptapEditor 核心 | 纯加法（onEditorReady 回调），不改现有 value/onChange 链路 |
| AIPanel→EditorWorkspace→TiptapEditor 穿线多层 | 接口收敛为 `onInsertMarkdown(md)`，面板只见这一个函数 |
| SnippetDrop 与 ImageUpload 冲突 | 互斥 mime（application/x-snippet vs image/*） |
| 仅 snippetToMarkdown 走 TDD | 接受；§13 手动验证清单覆盖全链路 |
| editor 实例类型 import 循环 | `onEditorReady` 用 `@tiptap/react` 的 `Editor` 类型；snippet-markdown.ts 用本地 `SnippetLike` 不依赖 Editor |

---

## 12. 非目标重申 / 偏差
- **偏差**：设计文档 §5.4 的拖拽「蓝色 drop indicator 线」—— TipTap 的 insertContentAt(dropPos) 自带位置语义，视觉指示线本轮不做（ProseMirror drop 默认有 caret 指示，够用）。
- **偏差**：摘录无右键菜单（设计文档 §4.1 提到「右键菜单 / toolbar 按钮」二选一）—— 本轮选 toolbar 按钮。
- **偏差**：面板卡片不复用 SnippetCard（精简版，避免引入 pin/delete 操作）。

---

## 13. 手动验证清单（browser）

**A. 面板（item 12）**
- [ ] 编辑器左 aside 出现第 3 个「灵感」tab，点击切换
- [ ] 列表加载素材（先在 /snippets 建几条不同 kind）
- [ ] 搜索框输入 → debounce 后过滤

**B. 点击插入（光标精确）**
- [ ] 编辑器光标放在段落中间 → 点面板卡片 → 内容插在光标处（不是末尾）
- [ ] text → 纯文本插入；quote → blockquote；image → 图片+配文；link → 链接 + 备注

**C. 拖拽插入（item 13）**
- [ ] 从面板卡片拖到编辑器某位置 → 内容插在 drop 位置
- [ ] 拖图片文件进编辑器仍走 ImageUpload（不冲突）
- [ ] 拖非素材文本（外部）正常（SnippetDrop return false）

**D. 摘录（item 14）**
- [ ] 选中编辑器一段文字 → 点「保存选区为灵感」→ 内联「✓ 已保存到灵感」2s
- [ ] 不选中文字 → 点按钮 → 内联「请先选中文字」2s
- [ ] 去 /snippets 看到新条目（kind=text，sourceArticleId 正确）

**E. 构建**
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm lint` 通过（lint 仅新增文件的 warning 可接受）

---

## 14. 实现顺序（建议）

1. **纯逻辑 TDD**：`snippet-markdown.ts` + 测试（红绿）。
2. **提 editor 句柄**：TiptapEditor 加 onEditorReady；EditorWorkspace 持 ref + insertMarkdown/getSelectionText；typecheck + build。
3. **SnippetInsertPanel** + AIPanel 第 3 tab：面板渲染 + 点击插入（先不接拖拽）；手动验证 A + B。
4. **SnippetDrop 扩展**：注册 + 拖拽；手动验证 C。
5. **摘录工具栏按钮**：手动验证 D。
6. **全量构建 + 清单 E**。
