# 素材块 P2-15 标签系统 Implementation Plan

> **执行方式**：本轮**内联执行**（executing-plans），不 per-task commit。spec + plan + 代码全部留未提交，最后用户确认后一次性提交。

**Goal:** 给素材块加上可用的标签系统 —— 创建栏标签输入 + 多标签 AND 筛选 + 标签级颜色（SystemConfig JSON），收尾 P2。

**Architecture:** 纯逻辑层（tag-filter / tag-colors，TDD）→ 服务端存储（tag-color-store via SystemConfig）→ API（GET 合并颜色 / PATCH 设色）→ SSR 聚合 → 组件（TagInput / TagColorPicker / Sidebar 多选 / Card pill 着色）→ SnippetsView 集成（activeTags AND 筛 + tagColors 状态 + 计数维护）。

**Tech Stack:** Next.js App Router + React + TS + Prisma 7 + vitest + Radix Popover + Tailwind（静态类）。

**Spec:** `docs/superpowers/specs/2026-07-08-snippets-p2-tag-system-design.md`（契约来源，下文引用 §号）

## Global Constraints

- **TDD 边界**：纯逻辑（`tag-filter.ts`、`tag-colors.ts`）走 vitest `tests/unit/`，红绿；组件/API/SSR 靠 typecheck + build + 手动验证
- **禁动态 Tailwind**（JIT purge，P1 踩过）：颜色类用 `Record<TagColorName, Classes>` 静态查表；测试断言字面量类名（如 `"bg-amber-500/10"`）
- **client bundle 禁 Node 依赖链**：`tag-colors.ts` / `tag-filter.ts` 不得 import prisma/better-sqlite3；存储接触隔离在服务端 `tag-color-store.ts`
- **无 toast 库**：用 ArticleMaterialsPanel 的内联反馈模式（state + setTimeout）
- **不 per-task commit**：本轮全部改动留未提交，最后用户确认后一次性提交
- **vitest 用 dev.db**：跑测前确保 migration 已 apply（`DATABASE_URL="file:./dev.db" npx prisma migrate deploy`）
- 命令：测 `pnpm test`（或 `npx vitest run tests/unit/<file>`）/ typecheck `pnpm typecheck` / build `pnpm build` / lint `pnpm lint`

---

## Task 1: 纯逻辑 `tag-filter.ts` + 测试（TDD）

**Files:**
- Create: `src/lib/snippets/tag-filter.ts`
- Test: `tests/unit/tag-filter.test.ts`

**Interfaces (spec §4.1):**
- `snippetMatchesAllTags(snippetTags: string[], activeTags: string[]): boolean`
- `collectUniqueTags(snippets: {tagsJson: string|null}[]): {name:string; count:number}[]`

- [ ] **Step 1: 写失败测试** `tests/unit/tag-filter.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { snippetMatchesAllTags, collectUniqueTags } from "@/lib/snippets/tag-filter";

describe("snippetMatchesAllTags", () => {
  it("空 activeTags 全通过", () => {
    expect(snippetMatchesAllTags(["a"], [])).toBe(true);
    expect(snippetMatchesAllTags([], [])).toBe(true);
  });
  it("单标签命中/不命中", () => {
    expect(snippetMatchesAllTags(["a", "b"], ["a"])).toBe(true);
    expect(snippetMatchesAllTags(["a"], ["b"])).toBe(false);
  });
  it("多标签全命中 true，缺一 false（AND）", () => {
    expect(snippetMatchesAllTags(["a", "b", "c"], ["a", "b"])).toBe(true);
    expect(snippetMatchesAllTags(["a", "b"], ["a", "b", "c"])).toBe(false);
  });
  it("大小写敏感", () => {
    expect(snippetMatchesAllTags(["A"], ["a"])).toBe(false);
  });
});

describe("collectUniqueTags", () => {
  it("空数组 → []", () => {
    expect(collectUniqueTags([])).toEqual([]);
  });
  it("单 snippet 多标签各计数 1", () => {
    const r = collectUniqueTags([{ tagsJson: '["a","b"]' }]);
    expect(r).toContainEqual({ name: "a", count: 1 });
    expect(r).toContainEqual({ name: "b", count: 1 });
  });
  it("多 snippet 共享标签计数累加 + count 降序", () => {
    const r = collectUniqueTags([
      { tagsJson: '["a","b"]' },
      { tagsJson: '["a","c"]' },
      { tagsJson: '["a"]' },
    ]);
    expect(r).toEqual([
      { name: "a", count: 3 },
      { name: "b", count: 1 },
      { name: "c", count: 1 },
    ]);
  });
  it("count 相同按 name 升序", () => {
    const r = collectUniqueTags([{ tagsJson: '["z","a","m"]' }]);
    expect(r.map((t) => t.name)).toEqual(["a", "m", "z"]);
  });
  it("非法 JSON / 非数组 / 空串 / 非字符串 跳过不崩", () => {
    const r = collectUniqueTags([
      { tagsJson: "not json" },
      { tagsJson: "[1,2]" },
      { tagsJson: '["", "ok", 3]' },
      { tagsJson: "null" },
    ]);
    expect(r).toEqual([{ name: "ok", count: 1 }]);
  });
  it("tagsJson: null 当空数组", () => {
    expect(collectUniqueTags([{ tagsJson: null }])).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测确认失败** — `npx vitest run tests/unit/tag-filter.test.ts` → FAIL（模块不存在）

- [ ] **Step 3: 实现** `src/lib/snippets/tag-filter.ts`

```ts
/**
 * 多标签 AND 筛选谓词。activeTags 为空 → true。
 * 大小写敏感。纯函数，无副作用。
 */
export function snippetMatchesAllTags(
  snippetTags: string[],
  activeTags: string[]
): boolean {
  return activeTags.every((t) => snippetTags.includes(t));
}

/**
 * 从一批 snippet 的 tagsJson 聚合去重 + 计数。
 * 按 count 降序、name 升序兜底。容错：非法 JSON / 非数组 / 非字符串 / 空串 全跳过。
 * 客户端安全：不 import 任何服务端模块。
 */
export function collectUniqueTags(
  snippets: { tagsJson: string | null }[]
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of snippets) {
    let tags: unknown;
    try {
      tags = JSON.parse(s.tagsJson ?? "[]");
    } catch {
      continue;
    }
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      if (typeof tag === "string" && tag.length > 0) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: 跑测确认通过** — `npx vitest run tests/unit/tag-filter.test.ts` → 全绿
- [ ] **Step 5: 不 commit**（本轮统一最后提交）

---

## Task 2: 纯逻辑 `tag-colors.ts` + 测试（TDD）

**Files:**
- Create: `src/lib/snippets/tag-colors.ts`
- Test: `tests/unit/tag-colors.test.ts`

**Interfaces (spec §3.2 / §4.2):** `TAG_COLOR_NAMES`, `TagColorName`, `DEFAULT_TAG_COLOR`, `TagColorClasses`, `isValidTagColor`, `getTagColorClasses`, `resolveTagColor`

- [ ] **Step 1: 写失败测试** `tests/unit/tag-colors.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  TAG_COLOR_NAMES,
  DEFAULT_TAG_COLOR,
  isValidTagColor,
  getTagColorClasses,
  resolveTagColor,
} from "@/lib/snippets/tag-colors";

describe("isValidTagColor", () => {
  it("8 色全 true", () => {
    for (const c of TAG_COLOR_NAMES) expect(isValidTagColor(c)).toBe(true);
  });
  it("null/undefined/空/非板色 false", () => {
    expect(isValidTagColor(null)).toBe(false);
    expect(isValidTagColor(undefined)).toBe(false);
    expect(isValidTagColor("")).toBe(false);
    expect(isValidTagColor("red")).toBe(false);
  });
});

describe("getTagColorClasses", () => {
  it("amber 返回 amber 类", () => {
    const cls = getTagColorClasses("amber");
    expect(cls.pill).toContain("bg-amber-500/10");
    expect(cls.dot).toContain("bg-amber-500");
  });
  it("null → slate 默认", () => {
    expect(getTagColorClasses(null)).toEqual(getTagColorClasses(DEFAULT_TAG_COLOR));
  });
  it("非法值 → slate 兜底", () => {
    expect(getTagColorClasses("red")).toEqual(getTagColorClasses("slate"));
  });
  it("所有 8 色类对象齐全 dot/pill/active/text", () => {
    for (const c of TAG_COLOR_NAMES) {
      const cls = getTagColorClasses(c);
      expect(cls.dot).toBeTruthy();
      expect(cls.pill).toBeTruthy();
      expect(cls.active).toBeTruthy();
      expect(cls.text).toBeTruthy();
    }
  });
});

describe("resolveTagColor", () => {
  it("映射有有效色 → 返回", () => {
    expect(resolveTagColor("a", { a: "blue" })).toBe("blue");
  });
  it("映射值无效 → null", () => {
    expect(resolveTagColor("a", { a: "red" })).toBe(null);
  });
  it("映射无此 tag → null", () => {
    expect(resolveTagColor("a", { b: "blue" })).toBe(null);
  });
});
```

- [ ] **Step 2: 跑测确认失败** — `npx vitest run tests/unit/tag-colors.test.ts` → FAIL
- [ ] **Step 3: 实现** `src/lib/snippets/tag-colors.ts`（静态类表，slate 为中性默认）

```ts
export const TAG_COLOR_NAMES = [
  "amber", "blue", "green", "rose", "purple", "orange", "teal", "slate",
] as const;
export type TagColorName = typeof TAG_COLOR_NAMES[number];
export const DEFAULT_TAG_COLOR: TagColorName = "slate";

export type TagColorClasses = {
  dot: string;
  pill: string;
  active: string;
  text: string;
};

// 静态 Tailwind 类（禁动态拼接，防 JIT purge）
const TAG_COLOR_CLASSES: Record<TagColorName, TagColorClasses> = {
  amber: {
    dot: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    active: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    text: "text-amber-600 dark:text-amber-400",
  },
  blue: {
    dot: "bg-blue-500",
    pill: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    active: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
    text: "text-blue-600 dark:text-blue-400",
  },
  green: {
    dot: "bg-green-500",
    pill: "bg-green-500/10 text-green-700 dark:text-green-300",
    active: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30",
    text: "text-green-600 dark:text-green-400",
  },
  rose: {
    dot: "bg-rose-500",
    pill: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    active: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
    text: "text-rose-600 dark:text-rose-400",
  },
  purple: {
    dot: "bg-purple-500",
    pill: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
    active: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30",
    text: "text-purple-600 dark:text-purple-400",
  },
  orange: {
    dot: "bg-orange-500",
    pill: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
    active: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
    text: "text-orange-600 dark:text-orange-400",
  },
  teal: {
    dot: "bg-teal-500",
    pill: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
    active: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30",
    text: "text-teal-600 dark:text-teal-400",
  },
  slate: {
    dot: "bg-slate-400",
    pill: "bg-muted text-muted-foreground",
    active: "bg-primary/10 text-primary border-primary/30",
    text: "text-muted-foreground",
  },
};

export function isValidTagColor(color: string | null | undefined): color is TagColorName {
  return color != null && (TAG_COLOR_NAMES as readonly string[]).includes(color);
}

export function getTagColorClasses(color: string | null | undefined): TagColorClasses {
  return isValidTagColor(color) ? TAG_COLOR_CLASSES[color] : TAG_COLOR_CLASSES[DEFAULT_TAG_COLOR];
}

export function resolveTagColor(tag: string, tagColors: Record<string, string>): string | null {
  const v = tagColors[tag];
  return isValidTagColor(v) ? v : null;
}
```

- [ ] **Step 4: 跑测确认通过** — `npx vitest run tests/unit/tag-colors.test.ts` → 全绿
- [ ] **Step 5: 不 commit**

---

## Task 3: 服务端 store + API（GET 合并颜色 / PATCH 设色）

**Files:**
- Create: `src/lib/snippets/tag-color-store.ts`
- Modify: `src/app/api/snippets/tags/route.ts`

**Consumes (Task 1/2):** `collectUniqueTags`, `isValidTagColor`, `TAG_COLOR_NAMES`
**Produces:** `getTagColors()`, `setTagColor(name,color)`；GET 返 `{name,count,color}[]`；PATCH 返 `{tagColors}`

- [ ] **Step 1: 实现** `src/lib/snippets/tag-color-store.ts`（spec §5）

```ts
import { prisma } from "@/lib/db";
import { isValidTagColor } from "./tag-colors";

const CONFIG_KEY = "inkpress.snippetTagColors";

/** 读 SystemConfig，仅保留 value 为有效颜色的键。损坏/缺失 → {}。 */
export async function getTagColors(): Promise<Record<string, string>> {
  const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === "string" && typeof v === "string" && isValidTagColor(v)) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 读-改-写：color 有效则设，null/无效则删键；upsert 回 SystemConfig；返回最新全量。 */
export async function setTagColor(
  name: string,
  color: string | null
): Promise<Record<string, string>> {
  const current = await getTagColors();
  if (color == null || !isValidTagColor(color)) {
    delete current[name];
  } else {
    current[name] = color;
  }
  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    update: { value: JSON.stringify(current) },
    create: { key: CONFIG_KEY, value: JSON.stringify(current) },
  });
  return current;
}
```

- [ ] **Step 2: 改 GET + 加 PATCH** `src/app/api/snippets/tags/route.ts`（spec §6）

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { collectUniqueTags } from "@/lib/snippets/tag-filter";
import { TAG_COLOR_NAMES } from "@/lib/snippets/tag-colors";
import { getTagColors, setTagColor } from "@/lib/snippets/tag-color-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 获取所有标签（去重 + 计数 + 颜色） */
export async function GET() {
  const snippets = await prisma.snippet.findMany({
    where: { trashed: false },
    select: { tagsJson: true },
  });
  const tagColors = await getTagColors();
  const tags = collectUniqueTags(snippets).map((t) => ({
    ...t,
    color: tagColors[t.name] ?? null,
  }));
  return NextResponse.json({ tags });
}

const patchSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.enum(TAG_COLOR_NAMES).nullable(),
});

/** 设置/清除某标签的颜色 */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { name, color } = parsed.data;
  const tagColors = await setTagColor(name, color);
  return NextResponse.json({ tagColors });
}
```

> `z.enum(TAG_COLOR_NAMES)`：`as const` readonly tuple，zod 接受。

- [ ] **Step 3: typecheck** — `pnpm typecheck` → 0 error
- [ ] **Step 4: 不 commit**

---

## Task 4: SSR `page.tsx` 切 collectUniqueTags + getTagColors

**Files:** Modify `src/app/snippets/page.tsx`

**Consumes (Task 1/3):** `collectUniqueTags`, `getTagColors`

- [ ] **Step 1: 改 page.tsx** — 删内联 Map 计数，tags 带 color（spec §7.8）

把现有 `allSnippets` 计数块替换为：
```ts
import { collectUniqueTags } from "@/lib/snippets/tag-filter";
import { getTagColors } from "@/lib/snippets/tag-color-store";
// ...
const [snippets, allSnippets] = await Promise.all([...]);  // 不变
const tags = collectUniqueTags(allSnippets);
const tagColors = await getTagColors();
const tagsWithColor = tags.map((t) => ({ ...t, color: tagColors[t.name] ?? null }));
```
并把 `<SnippetsView tags={tags}>` 改为 `tags={tagsWithColor}`。删除原来的 `tagCounts` Map 逻辑。

- [ ] **Step 2: typecheck** — `pnpm typecheck` → 0 error
- [ ] **Step 3: 不 commit**

---

## Task 5: `TagInput` + `SnippetCreateBar` 集成（创建带标签）

**Files:**
- Create: `src/components/snippets/TagInput.tsx`
- Modify: `src/components/snippets/SnippetCreateBar.tsx`

**Interfaces (spec §7.1):** `TagInput {value, onChange, suggestions, placeholder?}`

- [ ] **Step 1: 实现 `TagInput.tsx`** — chip 输入 + typeahead（spec §7.1）
  - 已选 chips（点 × 删除）；文本 input
  - 提交键：`Enter` / `,` / `Tab` → trim + 去重 + ≤20 字 + 最多 8 个；`Backspace` 空输入删最后；`Esc` 清当前输入；`↑↓` 导航 suggestion 下拉，`Enter` 选中
  - suggestions：排除已选，按 `includes` 过滤，最多 8 条
  - 失焦：丢弃未提交文本（不顺手加 tag）
- [ ] **Step 2: 改 `SnippetCreateBar.tsx`**
  - 加 `tags` state（`useState<string[]>([])`）+ 渲染 `<TagInput value={tags} onChange={setTags} suggestions={existingTags ?? []} placeholder="标签…（回车添加）" />`
  - 新增可选 prop `existingTags?: string[]`
  - `handleSubmit` 的 POST body 加 `tags`（当前 `{ content: trimmed }` → `{ content: trimmed, tags }`）
  - 创建成功 `setContent("")` 同时 `setTags([])`
- [ ] **Step 3: typecheck + build** — `pnpm typecheck && pnpm build` → 通过
- [ ] **Step 4: 不 commit**

---

## Task 6: `TagColorPicker` + `SnippetTagSidebar`（多选 + 颜色）

**Files:**
- Create: `src/components/snippets/TagColorPicker.tsx`
- Modify: `src/components/snippets/SnippetTagSidebar.tsx`

**Interfaces (spec §7.2 / §7.3):**
- `TagColorPicker { value: string|null; onSelect: (color: string|null) => void }`
- `SnippetTagSidebar { tags: {name,count,color}[]; activeTags: string[]; onToggleTag(name); onSetTagColor(name,color|null) }`

- [ ] **Step 1: 实现 `TagColorPicker.tsx`** — 8 色块网格（`TAG_COLOR_NAMES` → `getTagColorClasses(c).dot`）+ 选中 ring + 底部「清除」按钮（onSelect(null)）。作为 `PopoverContent` 内嵌。
- [ ] **Step 2: 改 `SnippetTagSidebar.tsx`**
  - props 从 `{tags, activeTag, onSelectTag}` → `{tags:{name,count,color}[], activeTags, onToggleTag, onSetTagColor}`
  - 每行：颜色点（`<Popover>` trigger，`getTagColorClasses(color).dot`，点开 `<TagColorPicker value={color} onSelect={(c)=>onSetTagColor(name,c)} />`）+ 标签名 button（`onToggleTag(name)`）+ 计数
  - 选中行类：`activeTags.includes(name)` → `getTagColorClasses(color).active`（color null 走 slate→primary）；未选 → 现 hover 样式
- [ ] **Step 3: typecheck + build**
- [ ] **Step 4: 不 commit**

---

## Task 7: `SnippetCard` + `SnippetList`（pill 着色 + 透传 tagColors）

**Files:** Modify `SnippetCard.tsx`、`SnippetList.tsx`

**Consumes (Task 2):** `resolveTagColor`, `getTagColorClasses`

- [ ] **Step 1: 改 `SnippetCard.tsx`**
  - 加 prop `tagColors: Record<string, string>`
  - 底部 tag pill：每个 tag `const color = resolveTagColor(t, tagColors);` 有色 → `<span className={getTagColorClasses(color).pill}>#{t}</span>`；无 → 维持现状 `text-primary/70`
- [ ] **Step 2: 改 `SnippetList.tsx`** — 加 prop `tagColors`，透传给 `<SnippetCard tagColors={tagColors} ...>`
- [ ] **Step 3: typecheck + build**
- [ ] **Step 4: 不 commit**

---

## Task 8: `SnippetsView` 集成（activeTags AND 筛 + tagColors 状态 + 计数维护）

**Files:** Modify `src/components/snippets/SnippetsView.tsx`

**Consumes:** Task 1 `snippetMatchesAllTags`；Task 5 `existingTags`；Task 6 Sidebar 新 props；Task 7 `tagColors` 透传

- [ ] **Step 1: 改 state**
  - `activeTag: string|null` → `activeTags: string[] = []`
  - `tags` 提升为可变 state（初始 = props.tags）；加 `setTagsState`
  - 派生 `tagColors: Record<string,string>` = 从 tags state 取有效色（`Object.fromEntries(tags.filter(t=>t.color).map(t=>[t.name,t.color!]))`）
- [ ] **Step 2: 改 handler**
  - `handleToggleTag(name)`：`setActiveTags(prev => prev.includes(name) ? prev.filter(t=>t!==name) : [...prev, name])`
  - `handleSetTagColor(name, color)`：乐观先本地更新 tags color → PATCH `/api/snippets/tags` `{name,color}` → 成功用返回 `tagColors` 重算；失败回滚 + 内联报错（`savedMsg` state + 2s 清，ArticleMaterialsPanel 模式）
  - `handleCreated(snippet)`：prepend snippets；解析 snippet.tagsJson，对每个 tag 在 tags state count+1（新 tag 加 `{name,count:1,color:null}`，已有保留 color）；按 count 降序重排
  - `handleDeleted(id)`：移除 snippet；该 snippet 各 tag count-1；count≤0 移除
  - `handleUpdated`：不变（本轮 tags 不经更新改）
- [ ] **Step 3: 改过滤** — 移除 `if (searchResults) return true` bypass：
  ```ts
  const filteredSnippets = baseList.filter((s) => {
    const sTags: string[] = JSON.parse(s.tagsJson || "[]");
    if (!snippetMatchesAllTags(sTags, activeTags)) return false;
    if (activeKind && s.kind !== activeKind) return false;
    return true;
  });
  ```
- [ ] **Step 4: 改 JSX 下传**
  - `<SnippetTagSidebar tags={tags} activeTags={activeTags} onToggleTag={handleToggleTag} onSetTagColor={handleSetTagColor} />`
  - `<SnippetList snippets={filteredSnippets} tagColors={tagColors} onDeleted onUpdated />`
  - `<SnippetCreateBar onCreated={handleCreated} existingTags={tags.map(t=>t.name)} />`
  - 设色失败内联提示渲染（侧栏附近）
- [ ] **Step 5: typecheck + build**
- [ ] **Step 6: 不 commit**

---

## Task 9: 全量构建验证（gate）

- [ ] **Step 1: typecheck** — `pnpm typecheck` → 0 error
- [ ] **Step 2: 单测全量** — `pnpm test` → 全绿（含新增 tag-filter / tag-colors）
- [ ] **Step 3: build** — `pnpm build` → SUCCESS
- [ ] **Step 4: lint** — `pnpm lint` → 0 error（仅新增文件 warning 可接受）
- [ ] **Step 5: 报告** — 汇总改动文件 + 测试结果给用户；**不 commit**，等用户确认后一次性提交

---

## Notes / 实现提醒
- `z.enum(TAG_COLOR_NAMES)` 用 `as const` tuple；如 zod 报类型错，改为 `z.enum(TAG_COLOR_NAMES as unknown as [string, ...string[]])` 但优先直接传（zod 支持 readonly tuple）。
- TagInput 失焦丢弃未提交文本 —— 避免误加标签。
- 颜色变更竞态：以 PATCH 返回的 `tagColors` 为准（最后写入胜出），乐观更新失败回滚。
- 部分（>40）列表筛 + tag：已知限制，本轮不动分页（spec §9）。
