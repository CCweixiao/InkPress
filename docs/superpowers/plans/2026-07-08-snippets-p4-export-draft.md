# 素材块 P4-23（导出为文章草稿）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans（inline）按 task 执行。**本项目约束：不自动 commit，全部完成后用户发话再统一提交。** 各 task 不含 commit，仅以 typecheck / 测试 / build / lint 作 gate。

**Goal:** /snippets 多选素材 → 一键组装成新 draft Article（正文按选择序 `---` 分隔）→ 跳 `/editor/[id]`；建 SnippetUsage（insertedVia="export"）双向溯源。

**Architecture:** 纯逻辑 `composeDraftBody` / `deriveDraftTitle`（复用 `snippetToMarkdown`，vitest）+ 端点 `POST /api/snippets/export-draft`（镜像 `/api/articles` 创建 pattern + SnippetUsage createMany）+ SnippetsView 选择模式（selectMode/selectedIds + 卡片 checkbox）。

**Tech Stack:** Next 16.2.9 · Prisma 7 · content-store（`writeContentAt`/`articleFilePath`）· vitest。

**Spec:** `docs/superpowers/specs/2026-07-08-snippets-p4-export-draft-design.md`

## Global Constraints

- **不自动 commit**。
- **客户端安全**：`draft-export.ts` 只 import `snippetToMarkdown`（纯，无 prisma），client/server 共用安全；端点仅服务端。
- **顺序保真**：端点按入参 `ids` 顺序重排 `findMany` 结果（`findMany` 不保序）。
- **SnippetUsage 唯一约束**：`@@unique([snippetId, articleId])` → `createMany` 用 `skipDuplicates:true` 容忍重复导出。
- **先 Article+正文成功再写 usage**：usage 失败不阻断（warn），溯源缺失可接受。
- **关键字 verbatim**：正文分隔 `"\n\n---\n\n"`、标题截断 `30`、ids 上限 `50`、insertedVia `"export"`、status `"draft"`。
- **TDD 边界 = 纯逻辑**：`composeDraftBody` / `deriveDraftTitle` 进 vitest；端点 / UI 走 typecheck + build + 手测。

## Pre-flight

- 分支：从当前 `feat/snippets-p4-link-og` 开 stacked 子分支 `feat/snippets-p4-export-draft`。

---

### Task 1: 纯逻辑（composeDraftBody / deriveDraftTitle）+ vitest

**Files:**
- Create: `src/lib/snippets/draft-export.ts`
- Test: `tests/unit/snippet-draft-export.test.ts`

**Interfaces:**
- Consumes: `snippetToMarkdown`, `SnippetLike` from `@/lib/ai/snippet-markdown`
- Produces:
  ```ts
  export function composeDraftBody(snippets: SnippetLike[]): string;
  export function deriveDraftTitle(snippets: SnippetLike[]): string;
  ```

- [ ] **Step 1: 写失败测试** `tests/unit/snippet-draft-export.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { composeDraftBody, deriveDraftTitle } from "@/lib/snippets/draft-export";

describe("composeDraftBody", () => {
  it("多条 text 用 --- 分隔", () => {
    const out = composeDraftBody([
      { kind: "text", content: "甲" },
      { kind: "text", content: "乙" },
    ]);
    expect(out).toBe("甲\n\n---\n\n乙");
  });
  it("单条不加分隔", () => {
    expect(composeDraftBody([{ kind: "text", content: "只有一条" }])).toBe("只有一条");
  });
  it("混合 kind 各自映射 md，--- 分隔", () => {
    const out = composeDraftBody([
      { kind: "text", content: "想法" },
      { kind: "quote", content: "金句", quoteSource: "作者" },
    ]);
    expect(out).toBe('想法\n\n---\n\n> "金句"\n>\n> —— 作者');
  });
  it("空数组返空串", () => {
    expect(composeDraftBody([])).toBe("");
  });
  it("link 映射为 [text](url)", () => {
    const out = composeDraftBody([
      { kind: "link", content: "看看", linkUrl: "https://x.com", linkTitle: "标题" },
    ]);
    expect(out).toBe("[标题](https://x.com) — 看看");
  });
});

describe("deriveDraftTitle", () => {
  it("有 title 用 title", () => {
    expect(deriveDraftTitle([{ kind: "text", content: "正文", title: "标题" }])).toBe("标题");
  });
  it("无 title 回落 content 首行", () => {
    expect(deriveDraftTitle([{ kind: "text", content: "第一行\n第二行" }])).toBe("第一行");
  });
  it("title 超长截断 30 字", () => {
    expect(deriveDraftTitle([{ kind: "text", content: "x", title: "一".repeat(50) }]).length).toBe(30);
  });
  it("content 超长截断 30 字", () => {
    expect(deriveDraftTitle([{ kind: "text", content: "一".repeat(50) }]).length).toBe(30);
  });
  it("空数组 fallback「素材草稿」", () => {
    expect(deriveDraftTitle([])).toBe("素材草稿");
  });
  it("首条全空 fallback「素材草稿」", () => {
    expect(deriveDraftTitle([{ kind: "text", content: "  " }])).toBe("素材草稿");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm vitest run tests/unit/snippet-draft-export.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/snippets/draft-export.ts`**

```ts
import { snippetToMarkdown, type SnippetLike } from "@/lib/ai/snippet-markdown";

/** 按序把素材拼成草稿正文，--- 分隔；过滤空片段。 */
export function composeDraftBody(snippets: SnippetLike[]): string {
  return snippets
    .map(snippetToMarkdown)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/** 首条素材 title → content 首行（≤30 字）→ 「素材草稿」。 */
export function deriveDraftTitle(snippets: SnippetLike[]): string {
  const first = snippets[0];
  if (!first) return "素材草稿";
  const t = (first.title ?? "").trim();
  if (t) return t.slice(0, 30);
  const c = ((first.content ?? "").trim().split("\n")[0] ?? "").trim();
  if (c) return c.slice(0, 30);
  return "素材草稿";
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm vitest run tests/unit/snippet-draft-export.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: 0 error。

---

### Task 2: 导出端点 `POST /api/snippets/export-draft`

**Files:**
- Create: `src/app/api/snippets/export-draft/route.ts`

**Interfaces:**
- Consumes: `composeDraftBody` / `deriveDraftTitle`（Task 1）；`writeContentAt` / `articleFilePath`（`@/lib/content-store`）；`prisma`；`withApiLog` / `logMutation`（`@/lib/api-log`）

- [ ] **Step 1: 写端点**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeContentAt, articleFilePath } from "@/lib/content-store";
import { composeDraftBody, deriveDraftTitle } from "@/lib/snippets/draft-export";
import { withApiLog, logMutation } from "@/lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
});

export const POST = withApiLog(
  "POST /api/snippets/export-draft",
  async (req: NextRequest) => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "ids 参数无效（1-50 条）" }, { status: 400 });
    }
    const ids = parsed.data.ids;

    // findMany 不保序 → 按入参 ids 顺序重排；丢弃不存在/已删
    const found = await prisma.snippet.findMany({
      where: { id: { in: ids }, trashed: false },
    });
    const byId = new Map(found.map((s) => [s.id, s]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as NonNullable<typeof byId extends Map<string, infer V> ? V : never>[];

    if (ordered.length === 0) {
      return NextResponse.json({ error: "没有可导出的素材" }, { status: 400 });
    }

    const markdown = composeDraftBody(ordered);
    const title = deriveDraftTitle(ordered);

    // 默认 theme（镜像 /api/articles POST）
    const defaultTheme =
      (await prisma.theme.findFirst({ where: { isDefault: true } })) ??
      (await prisma.theme.findFirst({ where: { isBuiltIn: true } }));
    const themeId = defaultTheme?.id ?? null;

    // 先建 Article 拿 id，再落盘正文
    const article = await prisma.article.create({
      data: { title, themeId, status: "draft" },
    });
    const contentPath = articleFilePath({ articleId: article.id, spaceId: null });
    try {
      await writeContentAt(contentPath, markdown);
      await prisma.article.update({ where: { id: article.id }, data: { contentPath } });
    } catch (e) {
      // 正文落盘失败：回滚 Article，避免空壳文章
      await prisma.article.delete({ where: { id: article.id } }).catch(() => {});
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "正文落盘失败" },
        { status: 500 }
      );
    }

    // SnippetUsage 双向溯源（skipDuplicates 容忍重复导出同素材到同文章）
    await prisma.snippetUsage
      .createMany({
        data: ordered.map((s) => ({
          snippetId: s.id,
          articleId: article.id,
          insertedVia: "export",
        })),
        skipDuplicates: true,
      })
      .catch(() => {
        /* 溯源缺失不阻断 */
      });

    logMutation("article", "create", {
      id: article.id,
      title: article.title,
      via: "snippets-export",
      snippetCount: ordered.length,
    });

    return NextResponse.json({ articleId: article.id }, { status: 201 });
  }
);
```

> 注：`ordered` 的类型推导可能繁琐，简化为 `const ordered = ids.map(...).filter(Boolean) as (typeof found)[number][];` 若上方泛型写法报错——实施时按 typecheck 调整。

- [ ] **Step 2: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 0 error / ✓ Compiled。

---

### Task 3: 选择模式 UI（SnippetsView + SnippetCard）

**Files:**
- Modify: `src/components/snippets/SnippetCard.tsx`（selectMode 下 checkbox + 点 body 切换 + 隐藏 hover 操作栏）
- Modify: `src/components/snippets/SnippetList.tsx`（透传 selectMode/selectedIds/onToggleSelect）
- Modify: `src/components/snippets/SnippetsView.tsx`（selectMode/selectedIds 状态 + 选择/导出按钮 + router.push）

- [ ] **Step 1: `SnippetCard` 新增 select props**

`interface SnippetCardProps` 追加：
```ts
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
```
解构 props 加 `selectMode, selected, onToggleSelect`。

- [ ] **Step 2: `SnippetCard` 选择态渲染**

根 `<Card>` 加条件 className + onClick（仅 selectMode）：
```tsx
  <Card
    className={cn(
      "group relative p-4 transition-all break-inside-avoid",
      selectMode ? "cursor-pointer" : "hover:shadow-md cursor-default",
      selected && "ring-2 ring-primary"
    )}
    onClick={selectMode ? onToggleSelect : undefined}
  >
```

左上角 checkbox（selectMode 下显示）——在卡片内容最前面加：
```tsx
        {selectMode && (
          <div className="absolute top-2 left-2 z-10 flex h-5 w-5 items-center justify-center rounded border bg-background">
            <input
              type="checkbox"
              checked={!!selected}
              readOnly
              className="h-4 w-4 accent-primary"
            />
          </div>
        )}
```

hover 操作栏（`<div className="absolute top-2 right-2 ...">`）selectMode 下隐藏：
```tsx
      {!selectMode && (
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100 transition-opacity">
          {/* 既有 refetch / 编辑 / 置顶 / 删除按钮 */}
        </div>
      )}
```

- [ ] **Step 3: `SnippetList` 透传**

`SnippetList` props 加 `selectMode?` / `selectedIds?: string[]` / `onToggleSelect?: (id:string)=>void`，传给 `SnippetCard`：
```tsx
  <SnippetCard
    key={s.id}
    snippet={s}
    tagColors={tagColors}
    existingTags={existingTags}
    onDeleted={onDeleted}
    onUpdated={onUpdated}
    selectMode={selectMode}
    selected={selectedIds?.includes(s.id)}
    onToggleSelect={onToggleSelect ? () => onToggleSelect(s.id) : undefined}
  />
```

- [ ] **Step 4: `SnippetsView` 选择状态 + 按钮 + 导出**

import 加 `useRouter`（已 import next/navigation）、`useState`（已有）。

组件内加 state：
```ts
  const router = useRouter();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleExport = async () => {
    if (selectedIds.length === 0) return;
    setExportMsg(null);
    try {
      const res = await fetch("/api/snippets/export-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导出失败");
      router.push(`/editor/${data.articleId}`);
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : "导出失败");
      window.setTimeout(() => setExportMsg(null), 3000);
    }
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds([]);
  };
```

类型筛选栏（现有「共 N 条灵感」`<span>` 处）替换为条件渲染：
```tsx
        {selectMode ? (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground">已选 {selectedIds.length}</span>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={selectedIds.length === 0}
              className="text-xs rounded-md bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              导出为草稿
            </button>
            <button
              type="button"
              onClick={exitSelect}
              className="text-xs text-muted-foreground hover:text-foreground px-2"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSelectMode(true)}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted ml-auto"
          >
            选择
          </button>
        )}
```
（去掉原「共 {totalCount} 条灵感」`<span>`——或与「选择」并列保留；实施时按当前文件结构调整，保留计数可放「选择」按钮左侧。）

`<SnippetList>` 调用处透传：
```tsx
          <SnippetList
            snippets={filteredSnippets}
            tagColors={tagColors}
            existingTags={tags.map((t) => t.name)}
            onDeleted={handleDeleted}
            onUpdated={handleUpdated}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
```
`exportMsg` 内联提示放在列表区上方（仿 `colorMsg`）。

- [ ] **Step 5: typecheck + build + lint**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: 0 error / ✓ Compiled / lint 0 errors。

- [ ] **Step 6: 手测**

1. /snippets 点「选择」→ 卡片显 checkbox、隐藏 hover 操作栏。
2. 点 2-3 张卡（不同 kind）→ 「已选 N」→ 「导出为草稿」→ 跳 `/editor/[id]`。
3. 正文按选择序、`---` 分隔、kind 各自映射。
4. 标题取首条素材 title/content。
5. 「取消」退出选择模式。
6. DB：新 Article status=draft；SnippetUsage insertedVia=`export`。

---

## Self-Review

**1. Spec 覆盖：**
- composeDraftBody / deriveDraftTitle（纯，复用 snippetToMarkdown）→ T1 + 测试 ✓
- 端点（按 ids 重排 + 建 Article + 写正文 + SnippetUsage skipDuplicates）→ T2 ✓
- 选择模式 UI（selectMode/selectedIds + checkbox + 导出按钮 + redirect）→ T3 ✓
- 顺序保真（入参 ids 重排）→ T2 ✓
- SnippetUsage 溯源 insertedVia="export" → T2 ✓
- 错误处理（ids 校验 / 正文失败回滚 / usage 失败不阻断 / 客户端内联提示）→ T2/T3 ✓

**2. Placeholder 扫描：** 无 TBD；分隔/截断/上限/insertedVia/status verbatim。T3 的「按当前文件结构调整」是镜像既有 JSX 的合理指引（计数放哪可微调），非占位。

**3. 类型一致性：** `SnippetLike` 复用 snippet-markdown 导出；prisma `Snippet` 结构兼容（多字段无碍）。`ordered` 类型推导若繁琐，注释里给了简化写法。

**4. 客户端安全：** `draft-export.ts` 仅 import `snippetToMarkdown`（纯，`@/lib/ai/snippet-markdown` 无 prisma/better-sqlite3）→ 可被 client（SnippetsView 不直接 import 它，但即便 import 也安全）+ server（端点）共用。端点 `withApiLog` 仅服务端。无 client bundle 污染。

**5. 唯一约束：** `SnippetUsage @@unique([snippetId, articleId])` → `createMany skipDuplicates:true` 容忍重复导出（同素材多次导出同文章不会因 unique 冲突报错）。

## Execution Handoff

Plan 完成并落盘 `docs/superpowers/plans/2026-07-08-snippets-p4-export-draft.md`。**Inline 执行**，T1→T2→T3。
