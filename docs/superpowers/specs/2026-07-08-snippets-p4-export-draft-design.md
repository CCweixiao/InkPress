# 素材块 P4-23（导出为文章草稿）设计

> 日期：2026-07-08
> 分支：`feat/snippets-p4-export-draft`（从 `feat/snippets-p4-link-og` 开 stacked 子分支）
> 范围：路线图 P4 的 **item 23**（多素材导出为文章草稿）。

## 目标

从 /snippets 页多选若干素材，一键组装成一篇新的 draft Article（正文按选择序拼接，`---` 分隔），跳转编辑器继续写作。创建 SnippetUsage 记录做双向溯源（文章←用了哪些素材）。

## 背景与现状

- **Article 创建 pattern**（`POST /api/articles`）：`prisma.article.create` → `articleFilePath({articleId,spaceId})` → `writeContentAt(contentPath, md)` → update contentPath。镜像即可。
- **`snippetToMarkdown(s)` 已存在**（`src/lib/ai/snippet-markdown.ts`，纯函数已测）：按 kind 映射 md（quote→blockquote / image→![alt](url) / link→[text](url) / text→content）。导出正文组装直接复用。
- **SnippetUsage** 模型（`prisma/schema.prisma:532`）：`{ snippetId, articleId, insertedVia }`，`insertedVia` 默认 `"at-mention"`，现值含 `drag-drop` / `sidebar`。加 `"export"`。
- **编辑器路由** `/editor/[id]`。
- **SnippetsView** 已有类型筛选栏 + 标签侧栏；`SnippetCard` 有 hover 编辑/置顶/删除/重抓按钮。
- 无既有「snippet→article」导出（`/api/articles/[id]/export` 是文章→文件，不同）。

## 关键设计决策（已与用户确认）

1. **选择粒度**：**多选**（SnippetsView 加选择模式：toggle 后卡片出 checkbox，按选择序导出）。单条由「选一条」覆盖。
2. **SnippetUsage 溯源 + 选择模式 UI**：均纳入本轮。
3. 正文分隔 `\n\n---\n\n`；标题取首条素材 title/content ≤30 字 fallback「素材草稿」；新建 draft + 跳 `/editor/[id]`；space/profile 默认 null；顺序按客户端入参 ids。

## 数据模型

无变更。复用 `Article` / `Snippet` / `SnippetUsage`。

## 架构

```
SnippetsView 选择模式 → 选 ids[] → 「导出为草稿」
  └─ POST /api/snippets/export-draft { ids[] }
       ├─ findMany(trashed:false) → 按 ids 顺序重排
       ├─ composeDraftBody(snippets)   // 纯函数
       ├─ deriveDraftTitle(snippets)   // 纯函数
       ├─ prisma.article.create(draft, 默认 theme, 无 space/profile)
       ├─ writeContentAt(contentPath, body)
       ├─ article.update({ contentPath })
       ├─ prisma.snippetUsage.createMany([{snippetId, articleId, insertedVia:"export"}])
       └─ return { articleId } → router.push("/editor/[id]")
```

### 模块布局

| 文件 | 职责 | 类别 |
|---|---|---|
| `src/lib/snippets/draft-export.ts`（新） | `composeDraftBody` / `deriveDraftTitle`（纯） | 纯逻辑 |
| `src/app/api/snippets/export-draft/route.ts`（新） | POST：组装 + 建 Article + 写正文 + SnippetUsage | 路由 |
| `src/components/snippets/SnippetsView.tsx`（改） | selectMode / selectedIds 状态 + 选择/导出按钮 | 前端 |
| `src/components/snippets/SnippetCard.tsx`（改） | selectMode 下 checkbox + 点 body 切换 | 前端 |
| `tests/unit/snippet-draft-export.test.ts`（新） | 纯函数测试 | 测试 |

**客户端 bundle 安全**：`draft-export.ts` 只 import `snippetToMarkdown`（纯，`@/lib/ai/snippet-markdown`，无 prisma）——可安全被 client 与 server 共用。端点仅服务端。

## 行为规约

### `composeDraftBody(snippets)`（纯）

- 输入 `Snippet[]`（已按选择序），输出 `snippets.map(snippetToMarkdown).filter(Boolean).join("\n\n---\n\n")`。
- 空 `snippets`（或全部空 md）→ 返 `""`。

### `deriveDraftTitle(snippets)`（纯）

- 首条素材 `title.trim()` 非空 → 用之（≤30 字截断）。
- 否则首条 `content.trim().split("\n")[0]` ≤30 字。
- 都空 / 数组空 → `"素材草稿"`。

### 端点 `POST /api/snippets/export-draft`

body `{ ids: string[] }`：
- 校验：`ids` 数组、非空、`length <= 50`，否则 400。
- `findMany({ where:{ id:{ in: ids }, trashed:false } })` → 按 `ids` 入参顺序重排（保选择序）；丢弃不存在/已删的。
- 重排后为空 → 400 `{ error:"没有可导出的素材" }`。
- `body = composeDraftBody(ordered)`；`title = deriveDraftTitle(ordered)`。
- 建默认 theme（`isDefault` → 回落 `isBuiltIn`，镜像 `/api/articles`）。
- `article = prisma.article.create({ data:{ title, themeId, status:"draft" } })`。
- `contentPath = articleFilePath({ articleId: article.id, spaceId: null })` → `writeContentAt(contentPath, body)` → `article.update({ contentPath })`。
- `prisma.snippetUsage.createMany({ data: ordered.map(s => ({ snippetId: s.id, articleId: article.id, insertedVia: "export" })) })`（`@@unique([snippetId, articleId])`——重复导出同素材到同文章会冲突，用 `skipDuplicates: true` 容忍）。
- `logMutation("article", "create", ...)`。
- 返回 `{ articleId: article.id }`（201）。
- try/catch：失败 → 500 `{ error }`。注意顺序：先 Article+正文成功再写 usage（usage 失败不回滚 Article，溯源缺失可接受）。

### 选择模式 UI

`SnippetsView`：
- 新 state `selectMode: boolean`（默认 false）、`selectedIds: string[]`（有序：check push、uncheck filter）。
- 类型筛选栏右侧「共 N 条灵感」旁加「选择」按钮（toggle selectMode）。selectMode 下改为「已选 {N} · 导出为草稿 · 取消」。
- 「导出为草稿」：`selectedIds.length > 0` 时可点；POST 端点 → 成功 `router.push("/editor/"+articleId)`；失败内联提示（沿用 colorMsg 模式）。导出成功后清空 selectedIds + 退出 selectMode。
- selectMode 下 `SnippetList` 传 `selectMode` / `selectedIds` / `onToggleSelect` 给卡片；过滤/搜索仍生效（在过滤后的集合里选）。

`SnippetCard`：
- 新 props `selectMode?: boolean` / `selected?: boolean` / `onToggleSelect?: () => void`。
- selectMode 下：左上角显 checkbox（selected ✓）；点卡片 body（`onClick`）→ `onToggleSelect`；禁用 hover 编辑/置顶等（或保留，但不冲突——点 body 才切换选中）。
- 非 selectMode：行为完全不变。

## 错误处理

- ids 空 / 超限 / 全无效 → 400。
- Article 创建 / 写文件失败 → 500。
- SnippetUsage 写失败（含 skipDuplicates）→ 不阻断（warn），Article 已建好。
- 客户端导出失败 → 内联提示，不跳转，保留选择。

## 测试边界（TDD = 纯逻辑）

vitest 覆盖 `composeDraftBody` + `deriveDraftTitle`：
- body：text/quote/link/image 混合、`---` 分隔、空数组返 `""`、单条。
- title：有 title / 无 title 回落 content / 超长截断 30 / 空数组 → 「素材草稿」。

**不**进 vitest：端点（Article 创建/文件写/SnippetUsage）、UI。走 typecheck + build + 手测。

## 验收（手测）

1. /snippets 点「选择」→ 卡片出 checkbox；点 2-3 张（不同 kind）→ 「导出为草稿」→ 跳 `/editor/[id]`。
2. 新文章正文按选择序，`---` 分隔，quote 是 blockquote、image 是 `![](...)`、link 是 `[](...)`、text 原样。
3. 标题取首条素材 title/content ≤30 字。
4. DB：新 Article status=draft；SnippetUsage 每条 insertedVia=`"export"`。
5. 不选就导出 → 按钮禁用 / 提示。
6. 导出失败（断网）→ 内联提示，不跳转，选择保留。

## 范围外（本轮不做）

- 单条快捷导出按钮（多选选一条即覆盖）。
- 导出时选 space/profile/theme。
- @面板 / QuickDialog 触发导出。
- 导出预览 / 拖拽调序（按选择序）。
- 重复导出去重（skipDuplicates 容忍，不主动提示）。
