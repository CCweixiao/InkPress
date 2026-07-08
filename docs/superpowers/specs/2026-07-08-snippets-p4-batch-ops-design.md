# 素材块 P4-22（批量操作）设计

> 日期：2026-07-08
> 分支：`feat/snippets-p4-batch-ops`（从 `feat/snippets-p4-export-draft` 开 stacked 子分支）
> 范围：路线图 P4 的 **item 22**（选择模式下的批量操作）。

## 目标

把 P4-23 已建好的「选择模式」（点「选择」→ 卡片出 checkbox + 隐藏 hover 栏）从「只能导出草稿」升级成**完整多选编辑**：批量**加标签 / 移除标签 / 置顶·取消 / 删除**。操作对象为当前选中的 ids，操作后退出选择模式。

## 背景与现状

- **选择模式基础设施已就绪**（P4-23 落地）：`SnippetsView` 有 `selectMode` / `selectedIds` state + `toggleSelect` / `exitSelect`；`SnippetList` 透传 `selectMode` / `selectedIds` / `onToggleSelect`；`SnippetCard` 在 selectMode 下出 checkbox、点 body 切换、隐藏 hover 栏。工具栏当前为「已选 N · 导出为草稿 · 取消」。
- **UI 原语齐备**：
  - `Popover`（`@/components/ui/popover`，Radix）→ tag picker 锚定。
  - `useConfirm()` hook（`@/components/ui/confirm-dialog`）→ 批量删除二次确认，替代 `window.confirm`。
  - `TagInput`（`@/components/snippets/TagInput`）校验常量：`MAX_TAGS=8` / `MAX_TAG_LEN=20`（本设计复用同值，不导入组件本身）。
- **标签存储**：`Snippet.tagsJson`（JSON 串，`string[]`）。SQLite 无原生 JSON array update → tag 增删需逐条 read-modify-write。
- **侧栏标签计数口径**（关键约束）：`/snippets` 页服务端用 `collectUniqueTags(allSnippets)`（**全量** snippets）算每个标签的 count；客户端 `snippets` state 只持有前 40 条。故批量操作后**不能**用客户端 40 条重算全量计数，必须按「选中项的 tag 变化」做 **delta 增减**——而批量只动可见选中项，delta 对全量计数准确。此模式与既有 `handleCreated` / `handleDeleted` 一致。
- **单卡删除**（`SnippetCard.handleDelete`）= 软删 `trashed=true`，可在回收站找回。批量删除沿用。
- **`withApiLog` / `logMutation`** 已用于 mutation 日志。

## 关键设计决策（已与用户确认）

1. **支持 4 个操作**：加标签、移除标签、置顶/取消置顶、删除（移入回收站）。「导出为草稿」保留。
2. **API 形态**：单一 `POST /api/snippets/batch`，body 带 `action` 判别（`delete` | `pin` | `addTag` | `removeTag`）。一个端点 + action 分发 = DRY，匹配声明式 registry 偏好。
3. **置顶语义**：单一 toggle——选中项**全部 pinned** → 按钮「取消置顶」（全置 false）；否则「置顶」（全置 true）。
4. **tag picker**：Popover 内「过滤输入 + 已有标签列表 + 新建行」。加标签列表 = 全部已有标签；移除标签列表 = 选中项里**已出现**的标签（union）。单次操作一个标签，应用后关 popover。
5. **删除二次确认**用 `useConfirm()`（destructive）。pin / tag 不确认（即时）。
6. **乐观更新**：操作后本地 delta 更新 `snippets` + `tags` 计数 → 退出选择模式；失败回滚 + 顶部 inline 提示（setTimeout，**无 toast lib**）。

## 数据模型

无变更。复用 `Snippet`（`tagsJson` / `pinned` / `trashed`）。

## 架构

```
SnippetsView 选择模式 → selectedIds[]
  ├─ 「加标签」Popover → 选/建一个 tag ─┐
  ├─ 「移除标签」Popover → 选一个 tag ─┤
  ├─ 「置顶/取消」（toggle）            ┤→ POST /api/snippets/batch { ids, action, ... }
  └─ 「删除」useConfirm ────────────────┘     ├─ dedupeIds + 校验
                                              ├─ findMany(trashed:false) 取实存行
                                              └─ switch(action):
                                                   delete   → updateMany trashed=true
                                                   pin      → updateMany pinned=body.pinned
                                                   addTag   → $transaction: 逐行 mergeTag → update tagsJson
                                                   removeTag→ $transaction: 逐行 removeTag → update tagsJson
                                            ← { ok:true, affected }
  客户端：乐观 delta 更新 snippets + tags 计数 → exitSelect()
```

### 模块布局

| 文件 | 职责 | 类别 |
|---|---|---|
| `src/lib/snippets/batch-ops.ts`（新） | 纯逻辑：`dedupeIds` / `mergeTag` / `removeTag` / `resolvePinToggle` / `collectTagsUnion` / `diffTagSets` / `applyTagDeltas` / `validateBatchBody` | 纯逻辑 |
| `src/app/api/snippets/batch/route.ts`（新） | POST：校验 + findMany + action 分发（updateMany / 事务 read-modify-write）+ 日志 | 路由 |
| `src/components/snippets/BatchTagPicker.tsx`（新） | Popover 内 tag picker（过滤 + 已有列表 + 新建行），加/移除共用 | 前端 |
| `src/components/snippets/SnippetsView.tsx`（改） | 工具栏 4 操作入口 + `handleBatch` + 乐观 delta 更新 | 前端 |
| `tests/unit/snippet-batch-ops.test.ts`（新） | 纯函数测试 | 测试 |

**客户端 bundle 安全**：`batch-ops.ts` 为纯函数、零 prisma 导入，可被 client（SnippetsView / BatchTagPicker）与 server（route）共用。

## 行为规约

### 纯函数（`src/lib/snippets/batch-ops.ts`）

- `dedupeIds(ids: string[]): string[]` — 保序去重（`[...new Set(ids)]`）。
- `mergeTag(existing: string[], tag: string): string[]` — `tag` 已在则原样返回；否则追加（受 `MAX_TAGS=8` 上限：已达上限原样返回）。
- `removeTag(existing: string[], tag: string): string[]` — 过滤掉 `tag`（不存在则原样返回）。
- `resolvePinToggle(selected: { pinned: boolean }[]): { target: boolean; label: "置顶" | "取消置顶" }` — `selected` 非空且**全部** `pinned` → `{ target:false, label:"取消置顶" }`；否则 `{ target:true, label:"置顶" }`。
- `collectTagsUnion(snippets: { tagsJson: string }[]): string[]` — 选中项所有标签的并集（去重、保序）；移除 picker 候选来源。
- `diffTagSets(before: string[], after: string[]): { added: string[]; removed: string[] }` — before→after 的增删 diff。
- `applyTagDeltas(tags: { name: string; count: number; color: string | null }[], deltas: Map<string, number>): 同类型[]` — 按 deltas 增减 count；count≤0 的项剔除；deltas 里新标签（原 tags 无）按正 delta 新增；返回值按 count 降序 + name 升序（与 `sortByCount` 一致）。
- `validateBatchBody(body: unknown): { ok: true; data: ParsedBatchBody } | { ok: false; error: string }` — 校验 `ids`（数组、去重后 1-50、每项非空串）、`action`（枚举）、`pin` 需 `pinned:boolean`、`addTag/removeTag` 需 `tag`（trim 后 1-20 字）。失败返 400 文案。

> `MAX_TAGS=8` / `MAX_TAG_LEN=20` 在 `batch-ops.ts` 内**本地声明**（与 `TagInput` 同值，注释标注同源），避免 client 组件为取常量而导入 `TagInput`（TagInput 是带状态的 client 组件，导入取常量无副作用但语义不净；纯常量本地声明更清晰）。

### 端点 `POST /api/snippets/batch`

- `runtime = "nodejs"`，`dynamic = "force-dynamic"`，外层 `withApiLog("POST /api/snippets/batch", ...)`。
- body 经 `validateBatchBody` 校验，失败 → 400 `{ error }`。
- `dedupeIds` → `found = prisma.snippet.findMany({ where:{ id:{ in: ids }, trashed:false } })`。`found` 为空 → 400 `{ error:"没有可操作的素材" }`。
- 按 `action` 分发：
  - `delete`：`updateMany({ where:{ id:{ in: foundIds }, trashed:false }, data:{ trashed:true } })`。
  - `pin`：`updateMany({ where:{ id:{ in: foundIds }, trashed:false }, data:{ pinned: body.pinned } })`。
  - `addTag`：`prisma.$transaction(async (tx) => { for (row of found) { const next = mergeTag(parse(row.tagsJson), body.tag); if (next 不变) continue; await tx.snippet.update({ where:{ id: row.id }, data:{ tagsJson: JSON.stringify(next) } }); } })`。
  - `removeTag`：同上，`removeTag` 替换 `mergeTag`。
- `logMutation("snippet", action, { count: found.length, tag: body.tag ?? undefined })`。
- 返回 `{ ok:true, affected: found.length }`（200）。
- try/catch：未预期错误 → 500 `{ error }`。事务内单条失败 → 整事务回滚 → 500。

### `BatchTagPicker` 组件

- props：`mode: "add" | "remove"`、`allTags: string[]`（add 用全部已有标签）、`selectedTags: string[]`（remove 用 union，外部算好传入）、`onPick: (tag: string) => void`、existingTagsCount?。
- 渲染：Popover trigger（「加标签」/「移除标签」按钮）+ PopoverContent：
  - 过滤输入框（受控 `query`）。
  - 候选列表 = `(mode==="add" ? allTags : selectedTags)` 经 `query` 过滤；点击 → `onPick(tag)`。
  - add 模式：若 `query` trim 非空且不匹配任何已有标签 → 末尾显「+ 新建「{query}」」行，点击 → `onPick(trim)`。
  - remove 模式：无新建行（只能移除已有的）。
  - 空候选（remove 下选中项无共同标签）→ 显「选中项没有标签」占位。
- `onPick` 后由调用方关 popover（受控 open state 在 SnippetsView）。

### 选择模式 UI（`SnippetsView`）

- 工具栏 selectMode 分支由「已选 N · 导出为草稿 · 取消」扩为：
  `已选 N · 导出为草稿 · 加标签 · 移除标签 · {置顶|取消置顶} · 删除 · 取消`
  （`selectedIds.length===0` 时除「取消」外全部 disabled）。
- 「置顶/取消」文案由 `resolvePinToggle(selectedIds.map(id => snippets.find(...)))` 算。
- `handleBatch(action, payload?)`：
  1. snapshot `snippets` + `tags`。
  2. 乐观本地更新（用纯函数算新 `snippets` + `tags` delta）：
     - `delete`：从 `snippets` 移除 ids；`tags` 按「每条被删 snippet 的 tags」做 −1 delta。
     - `pin`：`snippets` 中 ids 的 `pinned` 置 `target`（tag 计数不变）。
     - `addTag`：每条选中 `tagsJson` 经 `mergeTag`；`diffTagSets` 算 added → `tags` +delta。
     - `removeTag`：`removeTag` + `diffTagSets` 算 removed → `tags` −delta。
  3. `exitSelect()`（清 selectMode + selectedIds）。
  4. `fetch("/api/snippets/batch", { ids: selectedIds, action, ...payload })`。
  5. 失败 → 回滚 snapshot + `setBatchMsg(error)` + setTimeout 3s 清。
- 「删除」先 `await confirm({ title:"删除选中的 N 条素材？", description:"可在回收站找回", variant:"destructive", confirmText:"删除" })`，false 则返回。
- tag picker 的 `onPick` → `handleBatch(mode==="add" ? "addTag" : "removeTag", { tag })` + 关 popover。

## 错误处理

- ids 空 / 超限 / action 非法 / tag 缺失或超长 / pinned 缺失 → 400。
- findMany 为空（ids 全无效/已删）→ 400。
- 事务 / updateMany 抛错 → 500；客户端回滚 + inline 提示。
- 网络失败 → 客户端 inline 提示，选择状态已退出但数据已回滚（用户可重选重试）。

## 测试边界（TDD = 纯逻辑）

vitest 覆盖 `batch-ops.ts` 全部纯函数：
- `dedupeIds`：保序去重、空数组。
- `mergeTag`：新增 / 已存在原样返回 / 达 8 上限原样返回。
- `removeTag`：移除 / 不存在原样返回。
- `resolvePinToggle`：全 pinned→取消置顶；部分/全无→置顶；空数组→置顶。
- `collectTagsUnion`：多 snippet 标签并集去重保序。
- `diffTagSets`：纯增 / 纯减 / 增减并存 / 无变化。
- `applyTagDeltas`：正 delta 新增标签、负 delta 归零剔除、混合、排序。
- `validateBatchBody`：各 action 正例 + ids 超限/tag 超长/pinned 缺失/action 非法等反例。

**不**进 vitest：端点（updateMany / 事务）、`BatchTagPicker`、`SnippetsView` 手势。走 typecheck + build + 手测。

## 验收（手测）

1. /snippets「选择」→ 选 3 张（含不同 kind / 不同 tag）。
2. **加标签**：点「加标签」→ 过滤输入「foo」→ 列表无则「+ 新建」→ 点 → 3 张都加上 `#foo`；侧栏 `foo` 计数 +3（或新建为 3）。
3. **移除标签**：点「移除标签」→ 候选只含选中项已有标签 → 点一个 → 从所有选中移除；计数相应 −。
4. **置顶**：选中含已置顶+未置顶 → 按钮显「置顶」→ 点 → 全部 pinned=true；再选全 pinned 的 → 显「取消置顶」→ 全 false。
5. **删除**：点「删除」→ confirm 弹窗（destructive）→ 确认 → 卡片消失、计数 −；回收站可见。
6. 每次操作后自动退出选择模式，工具栏恢复「共 N 条 · 选择」。
7. 断网重试：操作失败 → 顶部 inline 红字提示，数据回滚（卡片/计数复原）。
8. 0 选中时「加标签/移除/置顶/删除/导出」全 disabled，「取消」可点。

## 范围外（本轮不做）

- 批量「移动到分组/space」（无分组模型）。
- 批量重新抓取 OG（link 专属，逐条异步，不适合同步批量端点）。
- 批量操作撤销 / undo。
- 批量「导出为草稿」已有，不改。
- @面板 / QuickDialog 内的批量。
- 全选 / 反选快捷按钮（可选后续）。
