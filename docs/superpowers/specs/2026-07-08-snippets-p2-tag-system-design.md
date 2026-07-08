# 素材块 P2-15：标签系统（侧栏多选筛选 + 标签级颜色 + 创建栏标签输入）

- **日期**：2026-07-08
- **范围**：P2 item 15「标签系统（侧栏 + 筛选 + 颜色）」—— JSON 版（不动 schema）
- **TDD 边界**：仅纯逻辑层 `src/lib/snippets/tag-filter.ts` + `tag-colors.ts`（vitest + `tests/unit/`）。组件 / API / SSR 靠 typecheck + build + 手动验证
- **上游设计文档**：`docs/features/snippets-design.md` §4.3 / §10 P2-15
- **上一轮**：P2（编辑器集成 12/13/14）已合并 PR #4 → main

---

## 1. 目标与非目标

### 目标
1. **创建栏标签输入**（补漏）：`SnippetCreateBar` 增加 typeahead chip 输入，创建时带 `tags` 数组。**当前 UI 完全没有设置标签的入口**（create bar 只发 `{content}`，PATCH 支持但无组件调用）—— 这是让整个标签系统可用的前置基础设施。
2. **多标签 AND 筛选**（§4.3 明确目标）：侧栏 `activeTags: string[]`，点击切换，AND 逻辑（`every`）。替换当前单标签 toggle。
3. **标签级颜色**（§4.3「标签支持颜色标记」）：SystemConfig 存 `tagColors` 映射（`tagName → color`），侧栏标签 + 卡片 tag pill 按色渲染。

### 非目标（本轮不做）
- 卡片级标签编辑（新增/删除已有 snippet 的 tag）→ P3-16 原地编辑
- 侧栏标签拖拽排序 → P4-21 SnippetTag 独立表
- 标签重命名/删除（跨 snippet 级联改 tagsJson）→ P4-21
- 服务端 `?tag=` 多标签支持（UI 已客户端筛；本轮不动服务端 tag 查询）
- `Snippet.color` 字段（per-snippet 强调色）—— 本轮不用，留给未来

### 偏差说明
- **必含偏差**：原 P2-15 字面只写「侧栏 + 筛选 + 颜色」，但当前无设置标签的 UI，三者无的放矢。故本轮**必须**加「创建栏标签输入」。已有 snippet 的标签编辑随 P3-16。
- **颜色存储偏差**：§4.3 说「标签颜色」、§6.1 的 `color` 字段挂在 Snippet 上 —— 设计文档自相矛盾。本轮按用户决定走**标签级颜色**（SystemConfig JSON），不用 `Snippet.color`。P4-21 来时把存储从 SystemConfig 迁到 SnippetTag 表，渲染层不变。

---

## 2. 背景与现状（已 Explore 确认）

| 文件 | 现状 | 本轮改动 |
|------|------|---------|
| `SnippetCreateBar.tsx` | 只发 `{content}`，无标签输入 | 加 `TagInput`，POST 带 `tags` |
| `SnippetTagSidebar.tsx` | 单标签 toggle（`activeTag: string\|null`），无颜色 | 多选 + 颜色点 + picker |
| `SnippetCard.tsx` | tag pill 写死 `text-primary/70` | 按 tagColors 着色 |
| `SnippetList.tsx` | 透传 onDeleted/onUpdated | 加透传 `tagColors` |
| `SnippetsView.tsx` | `activeTag` 单标签客户端筛；搜索时 bypass tag/kind 筛 | `activeTags` AND 筛（本地 + 搜索结果都应用）；持有 tags 状态 + handleSetTagColor |
| `app/snippets/page.tsx` | 内联标签计数（与 `/api/snippets/tags` 重复） | 用 `collectUniqueTags` + `getTagColors` 合并颜色 |
| `api/snippets/tags/route.ts` | 只返回 `{name,count}[]` | 合并 `getTagColors()` → `{name,count,color}[]` |
| `api/snippets/[id]/route.ts` | PATCH 已支持 `tags` | 不动 |
| `SnippetItem.color` | 字段存在但未用 | 不动（留给未来） |

**关键坑**：标签计数逻辑目前重复存在于 `page.tsx` 与 `/api/snippets/tags`，本轮抽成 `collectUniqueTags` 共享（DRY）。

---

## 3. 颜色模型

### 3.1 存储
- `SystemConfig` 一行：`key = "inkpress.snippetTagColors"`，`value = JSON.stringify({ "产品想法": "amber", ... })`
- 沿用现有 `inkpress.llm` / `inkpress.oss` 约定。**零 schema 变更。**

### 3.2 调色板（8 色，静态 Tailwind 类）
> **必须静态类**：`bg-${color}/10` 会被 Tailwind JIT purge（P1 已踩过）。用 `Record<TagColorName, Classes>` 查表。

```ts
export const TAG_COLOR_NAMES = ["amber", "blue", "green", "rose", "purple", "orange", "teal", "slate"] as const;
export type TagColorName = typeof TAG_COLOR_NAMES[number];
export const DEFAULT_TAG_COLOR: TagColorName = "slate";
```

每色四组静态类：`dot`（实心圆点）/ `pill`（卡片 tag pill 背景+文字）/ `active`（侧栏选中行）/ `text`（纯文字）。`slate` 为中性默认（pill 用 `bg-muted text-muted-foreground`，active 用 primary）。

### 3.3 P4-21 迁移路径
`getTagColors()` / `setTagColor()` 是唯一接触存储的入口。P4-21 把它俩的后端从 SystemConfig 换成 SnippetTag 表；`getTagColorClasses` 等纯渲染函数零改动。重做 ≈ 一个函数体。

---

## 4. 纯逻辑层（TDD）

### 4.1 `src/lib/snippets/tag-filter.ts`

```ts
/** 多标签 AND 筛选谓词。activeTags 为空 → true（全通过）。 */
export function snippetMatchesAllTags(
  snippetTags: string[],
  activeTags: string[]
): boolean;

/**
 * 从一批 snippet 的 tagsJson 聚合去重 + 计数，按 count 降序、name 升序兜底。
 * 容错：非法 JSON / 非数组 / 非字符串 / 空串 全部跳过。
 * 共享给 page.tsx 与 /api/snippets/tags（消除现有重复）。
 */
export function collectUniqueTags(
  snippets: { tagsJson: string | null }[]
): { name: string; count: number }[];
```

**测试**（`tests/unit/tag-filter.test.ts`）：
- `snippetMatchesAllTags`
  - 空 activeTags → true（无论 snippetTags）
  - 单标签命中 → true；不命中 → false
  - 多标签全命中 → true；缺一个 → false（AND 语义）
  - 大小写敏感（`"A"` ≠ `"a"`）
- `collectUniqueTags`
  - 空数组 → `[]`
  - 单 snippet 多标签 → 各计数 1
  - 多 snippet 共享标签 → 计数累加
  - 按 count 降序；count 相同按 name 升序（`localeCompare`）
  - 非法 JSON / 非数组 / 空串 / 非字符串 → 跳过不崩
  - `tagsJson: null` → 当空数组

### 4.2 `src/lib/snippets/tag-colors.ts`

```ts
export const TAG_COLOR_NAMES: readonly TagColorName[];
export type TagColorName = "amber" | "blue" | "green" | "rose" | "purple" | "orange" | "teal" | "slate";
export const DEFAULT_TAG_COLOR: TagColorName;

export type TagColorClasses = { dot: string; pill: string; active: string; text: string };

/** 类型守卫：color 是否在调色板内。 */
export function isValidTagColor(color: string | null | undefined): color is TagColorName;

/** 取静态类；非法/空 → DEFAULT_TAG_COLOR（slate）的类。 */
export function getTagColorClasses(color: string | null | undefined): TagColorClasses;

/** 从映射查某标签的颜色；无效值 → null。 */
export function resolveTagColor(tag: string, tagColors: Record<string, string>): string | null;
```

**测试**（`tests/unit/tag-colors.test.ts`）：
- `isValidTagColor`：8 色全 true；`null`/`undefined`/`"red"`/`""` → false
- `getTagColorClasses`：`"amber"` 返回 amber 类对象；`null` → slate 类对象；`"red"` → slate（兜底）
- `resolveTagColor`：映射有有效色 → 返回；映射值无效 → null；映射无此 tag → null
- **静态类断言**：`getTagColorClasses("amber").pill` 须含字面量 `"bg-amber-500/10"`（防 JIT purge 回归）

> **客户端安全**：`tag-colors.ts` 与 `tag-filter.ts` 不得 import prisma / better-sqlite3（client bundle 红线）。存储接触隔离在服务端 `tag-color-store.ts`。

---

## 5. 服务端存储 `src/lib/snippets/tag-color-store.ts`（非 TDD，DB 层）

```ts
import { prisma } from "@/lib/db";
import { isValidTagColor } from "./tag-colors";

const CONFIG_KEY = "inkpress.snippetTagColors";

/** 读 SystemConfig，仅保留 value 为有效颜色的键。损坏/缺失 → {}。 */
export async function getTagColors(): Promise<Record<string, string>>;

/** 读-改-写：color 有效则设，null/无效则删键；upsert 回 SystemConfig；返回最新全量 map。 */
export async function setTagColor(name: string, color: string | null): Promise<Record<string, string>>;
```

- `prisma.systemConfig.upsert({ where:{key}, update:{value}, create:{key,value} })`
- 仅服务端 import（`@/lib/db` 拉 prisma）。

---

## 6. API

### 6.1 `GET /api/snippets/tags`（改）
合并颜色，返回 `{name, count, color}[]`：
```ts
const snippets = await prisma.snippet.findMany({ where:{trashed:false}, select:{tagsJson:true} });
const tagColors = await getTagColors();
const tags = collectUniqueTags(snippets).map(t => ({ ...t, color: tagColors[t.name] ?? null }));
return NextResponse.json({ tags });
```

### 6.2 `PATCH /api/snippets/tags`（新增）
```ts
const patchSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.enum(TAG_COLOR_NAMES).nullable(),   // null = 清除
});
// safeParse 失败 → 400
const { name, color } = parsed.data;
const tagColors = await setTagColor(name, color);
return NextResponse.json({ tagColors });
```
- `z.enum(TAG_COLOR_NAMES)`：`TAG_COLOR_NAMES` 是 `as const` readonly tuple，zod 接受。

---

## 7. 组件契约

### 7.1 `TagInput.tsx`（新）
```tsx
interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];        // 已有标签名（去重，排除已选）
  placeholder?: string;
}
```
行为：
- chips（已选）+ 文本输入；`Enter` / `,` / `Tab` 提交（trim、去重、≤20 字、最多 8 个）；`Backspace` 空输入删最后一个；`Esc` 清当前输入
- typeahead：输入时按 `includes` 过滤 suggestions，下拉最多 8 条，`↑↓` 导航 `Enter` 选中
- 失焦时丢弃未提交文本（不顺手加为 tag —— 零误触）

### 7.2 `TagColorPicker.tsx`（新）
```tsx
interface TagColorPickerProps {
  value: string | null;
  onSelect: (color: string | null) => void;   // null = 清除
}
```
- 8 色块网格（`TAG_COLOR_NAMES` → `getTagColorClasses(c).dot`），选中态加 ring；底部「清除」按钮
- 作为 `PopoverContent` 内嵌使用（不自带 Root）

### 7.3 `SnippetTagSidebar.tsx`（改）
```tsx
interface SnippetTagSidebarProps {
  tags: { name: string; count: number; color: string | null }[];
  activeTags: string[];
  onToggleTag: (tag: string) => void;          // 在 activeTags 中则移除，否则加入
  onSetTagColor: (name: string, color: string | null) => void;
}
```
每行：
- **颜色点**（`Popover` trigger，`getTagColorClasses(color).dot`）→ 点开 `TagColorPicker`
- **标签名**（button → `onToggleTag`）
- **计数**
- 选中行用 `getTagColorClasses(color).active`（color 为 null 时 active 走 primary/slate）

### 7.4 `SnippetCard.tsx`（改）
- 新增 prop `tagColors: Record<string, string>`
- 底部 tag pill：每 tag 查 `resolveTagColor(t, tagColors)`；有有效色 → `getTagColorClasses(color).pill`；无 → 维持现状 `text-primary/70`
- 其余不变

### 7.5 `SnippetList.tsx`（改）
- 加 prop `tagColors: Record<string, string>`，透传给每个 `SnippetCard`

### 7.6 `SnippetCreateBar.tsx`（改）
- 加 `tags` 本地状态 + `<TagInput value onChange suggestions={...} />`（suggestions 从新 prop 或 props 传入）
- `handleSubmit` 的 POST body 加 `tags`
- 新增可选 prop `existingTags?: string[]`（由 SnippetsView 传入当前标签名集合）

### 7.7 `SnippetsView.tsx`（改）
- `activeTag: string|null` → `activeTags: string[]`
- `tags` 提升为可变 state（初始 = SSR 传入；颜色变更后本地更新），每项 `{name,count,color}`
- `handleToggleTag(name)`：在/不在 activeTags 切换
- `handleSetTagColor(name, color)`：`PATCH /api/snippets/tags` 成功 → 用返回的 `tagColors` 重算每 tag 的 color 并 setState（乐观：先本地更新，失败回滚 + 内联报错）
- 过滤：`filteredSnippets = baseList.filter(s => snippetMatchesAllTags(parseTags(s), activeTags) && (!activeKind || s.kind===activeKind))`，**移除** `if (searchResults) return true` bypass（搜索结果也应用 tag/kind 筛）
- 透传 `tagColors`（从 tags state 派生 `Record<string,string>`）给 `SnippetList` → `SnippetCard`
- 给 `SnippetCreateBar` 传 `existingTags = tags.map(t=>t.name)`
- **tags 计数维护**（保持侧栏与列表一致）：
  - `handleCreated(snippet)`：prepend 到 `snippets`；对该 snippet 每个 tag，在 `tags` state 中 count+1（新 tag 则新增 `{name, count:1, color:null}`，保留已有 color）；按 count 降序重排
  - `handleDeleted(id)`：从 `snippets` 移除；找到被删 snippet 的 tags，对应 count-1；count≤0 的 tag 从 `tags` 移除（其颜色设置仍留 SystemConfig，下次该 tag 重现时无色）
  - `handleUpdated`：本轮 tags 不经更新改变（无卡片级 tag 编辑），tags 计数不动

### 7.8 `app/snippets/page.tsx`（改）
```ts
const [snippets, allSnippets] = await Promise.all([...]);
const tags = collectUniqueTags(allSnippets);
const tagColors = await getTagColors();
const tagsWithColor = tags.map(t => ({ ...t, color: tagColors[t.name] ?? null }));
// 传 tagsWithColor 给 SnippetsView
```
（删掉内联 Map 计数逻辑）

---

## 8. 数据流

**创建带标签**：
```
SnippetCreateBar TagInput → tags state → POST /api/snippets {content, tags}
→ onCreated(snippet) 带回 tagsJson → SnippetsView 更新 snippets + tags 计数
```

**多标签筛选**：
```
侧栏点标签 → onToggleTag → activeTags[] → snippetMatchesAllTags() 过滤本地/搜索列表
```

**设标签颜色**：
```
侧栏颜色点 → Popover/TagColorPicker → onSelect(color)
→ handleSetTagColor(name,color) → PATCH /api/snippets/tags {name,color}
→ 返回 tagColors → 重算 tags[].color → setState → 侧栏点 + 卡片 pill 即刻变色
```

**SSR 初载**：
```
page.tsx → collectUniqueTags(allSnippets) + getTagColors() → tags[].color → SnippetsView
```

---

## 9. 边界与错误处理

| 场景 | 行为 |
|------|------|
| 设色 API 失败 | 回滚本地 tags color，内联「保存失败」2s |
| SystemConfig 行损坏 | `getTagColors` 返回 `{}`（容错） |
| 非法颜色名（绕过前端） | zod 400；`setTagColor` 也按 isValidTagColor 二次过滤 |
| 标签含特殊字符 / 引号 | tagsJson 是 JSON.stringify，安全；substring 查询不涉及（客户端用 includes） |
| 无任何标签 | 侧栏不渲染（`tags.length>0 &&`）；TagInput suggestions 空，仍可自由输入新标签 |
| 已选标签超过 8 个 | TagInput 拒绝再添 |
| 部分列表筛选 | SSR take 40，客户端 AND 筛只作用于已载集合；搜索覆盖全文。**已知限制，本轮不动分页** |

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 动态 Tailwind 类被 purge | `getTagColorClasses` 静态查表；测试断言字面量类名 |
| client bundle 拉 prisma | tag-colors/tag-filter 零服务端 import；存储隔离在 store |
| 颜色变更竞态（多次快速点） | PATCH 返回全量 tagColors，以最后一次返回为准；乐观更新 + 失败回滚 |
| collectUniqueTags 改动影响现有计数 | 纯函数 + 充分单测；page.tsx 与 API 都切到它，行为对齐 |
| Popover 与已有样式冲突 | 复用 ui/popover（Radix），与 SnippetMentionPopover 同源 |

---

## 11. 手动验证清单（browser）

**A. 创建带标签**
- [ ] 创建栏出现 TagInput；输入「产品」回车 → chip；再输已有标签有 typeahead 下拉
- [ ] Ctrl+Enter 创建 → /snippets 出现新卡，底部 `#产品想法`
- [ ] 已选标签超 8 个拒绝再添；Backspace 空输入删最后一个

**B. 多标签筛选**
- [ ] 侧栏点标签 A → 列表筛出含 A 的；再点 B → AND（同时含 A+B）；再点 A → 取消 A
- [ ] 搜索框输入时，结果也应用当前 activeTags 筛选
- [ ] 无标签时侧栏不渲染

**C. 标签颜色**
- [ ] 侧栏每个标签左侧有颜色点；点击 → 8 色 picker；选 amber → 侧栏点名 + 行高亮变 amber；卡片对应 tag pill 变 amber
- [ ] 「清除」→ 颜色恢复默认
- [ ] 刷新页面颜色仍在（SystemConfig 持久化）
- [ ] 断网设色 → 内联「保存失败」+ 回滚

**D. 构建**
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm lint` 通过（lint 仅新增文件 warning 可接受）

---

## 12. 实现顺序（建议）
1. 纯逻辑 TDD：`tag-filter.ts` + `tag-colors.ts` + 测试（红绿）
2. 服务端 store + API：`tag-color-store.ts`、改 GET `/tags`、新增 PATCH `/tags`
3. SSR：`page.tsx` 切 `collectUniqueTags` + `getTagColors`
4. `TagInput` + `SnippetCreateBar` 集成（创建带标签）
5. `TagColorPicker` + `SnippetTagSidebar`（多选 + 颜色）
6. `SnippetCard` + `SnippetList`（tag pill 着色 + 透传 tagColors）
7. `SnippetsView`（activeTags AND 筛 + tagColors 状态 + handleSetTagColor + 派生传下游）
8. 全量构建 + 清单 D
