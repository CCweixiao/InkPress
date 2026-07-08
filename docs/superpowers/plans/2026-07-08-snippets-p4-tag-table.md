# 素材块 P4-21（SnippetTag 独立表）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans（inline）按 task 执行。**本项目约束：不自动 commit，全部完成后用户发话再统一提交。** 仅以 vitest / typecheck / build / lint / migration 对账 / 手测作 gate。

**Goal:** `Snippet.tagsJson`（JSON 串）→ `SnippetTag`+`SnippetTagAssignment`（M2M）；API 派生 `tags: string[]`；migration `json_each` 回填；**tagsJson 列保留作安全网**；桌面行为不变。

**Architecture:** schema+migration（回填 SQL）→ server tag-repo（find-or-create/sync/bulk/count/serialize）→ 路由改写（写 syncSnippetTags/bulk；读 include+serialize+relation 过滤）→ 客户端 `tagsJson:string`→`tags:string[]`。

**Tech Stack:** Prisma 7（better-sqlite3，SQLite 3.45+ `json_each`/`randomblob`）· vitest。

**Spec:** `docs/superpowers/specs/2026-07-08-snippets-p4-tag-table-design.md`

## Global Constraints

- **不自动 commit**。
- **数据回填走 migration.sql**（CLAUDE.md：数据变更唯一入口）。**不 DROP tagsJson**（安全网，下轮再删）。
- **客户端安全**：`tag-repo.ts` 仅服务端（import prisma）；客户端只收 `tags: string[]`，零 prisma 入 bundle。
- **SQLite createMany 不支持 skipDuplicates** → bulkAddTag 先 select 已有过滤再 createMany。
- **API 契约 breaking**：`tagsJson:string`→`tags:string[]`。T3-T6 改造期间 typecheck 会暂时报错（契约迁移中），**以最终 typecheck+build 为 gate**。
- **颜色 store 零改**（name 索引）。
- **TDD = 纯逻辑**：tag-repo 纯函数（serialize/tagWhere/名字规整）进 vitest；prisma/路由/migration/组件走 typecheck+build+手测。

## Pre-flight

- 分支：从当前 `feat/snippets-p4-mobile` 开 stacked 子分支 `feat/snippets-p4-tag-table`。

---

### Task 1: schema + migration + prisma generate

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_snippet_tag_table/migration.sql`（经 `--create-only` 生成后手填回填段）

- [ ] **Step 1: schema.prisma 加模型**

`model Snippet` 内 `usages SnippetUsage[]` 行附近追加关系字段：
```prisma
  tagAssignments SnippetTagAssignment[]
```
`tagsJson` 那行注释改为 `// 标签数组 JSON（已迁移至 SnippetTag 关系表；保留作回滚安全网，不再读写）`（字段保留）。

在 `model SnippetUsage` 之后追加两模型：
```prisma
/// 标签独立表（P4-21，原 Snippet.tagsJson 迁移而来）。name 全局唯一。
model SnippetTag {
  id        String   @id @default(cuid())
  name      String   @unique
  createdAt DateTime @default(now())
  assignments SnippetTagAssignment[]

  @@index([name])
}

/// snippet ↔ tag 多对多赋值（镜像 SnippetUsage 显式联表风格）。
model SnippetTagAssignment {
  id        String   @id @default(cuid())
  snippetId String
  tagId     String
  createdAt DateTime @default(now())

  snippet Snippet   @relation(fields: [snippetId], references: [id], onDelete: Cascade)
  tag     SnippetTag @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@index([snippetId])
  @@index([tagId])
  @@unique([snippetId, tagId])
}
```

- [ ] **Step 2: 生成 migration（不应用）**

Run: `pnpm prisma migrate dev --create-only --name snippet_tag_table`
Expected: 生成 `prisma/migrations/<ts>_snippet_tag_table/migration.sql`，含 `CREATE TABLE "SnippetTag"` / `"SnippetTagAssignment"` + 唯一索引 + FK。**不**含对 tagsJson 的 DROP（保留列）。

- [ ] **Step 3: 在生成的 migration.sql 末尾追加回填 SQL**

```sql

-- P4-21 数据回填：从 Snippet.tagsJson 迁移到 SnippetTag + SnippetTagAssignment。
-- 依赖 SQLite json_each / randomblob（better-sqlite3 自带 3.45+）。
-- tagsJson 列保留（安全网），不 DROP。

-- 1) distinct tag name → SnippetTag
INSERT OR IGNORE INTO "SnippetTag" (id, name)
SELECT lower(hex(randomblob(16))), j.value
FROM (
  SELECT DISTINCT je.value AS value
  FROM "Snippet", json_each("Snippet"."tagsJson") AS je
  WHERE je.value IS NOT NULL AND length(CAST(je.value AS TEXT)) > 0
) AS j;

-- 2) (snippet, tag) → SnippetTagAssignment（INSERT OR IGNORE 容忍同 snippet JSON 内重复 tag）
INSERT OR IGNORE INTO "SnippetTagAssignment" (id, snippetId, tagId)
SELECT lower(hex(randomblob(16))), s."id", t."id"
FROM "Snippet" s, json_each(s."tagsJson") AS je
JOIN "SnippetTag" t ON t."name" = je.value
WHERE je.value IS NOT NULL AND length(CAST(je.value AS TEXT)) > 0;
```

- [ ] **Step 4: 应用 migration + 重新生成 client**

Run: `pnpm prisma migrate deploy && pnpm prisma generate`
Expected: migration 应用成功；`src/generated/prisma` 含 SnippetTag / SnippetTagAssignment。

- [ ] **Step 5: 回填对账**

Run（sqlite3 或 prisma studio / 手查）：
```bash
pnpm prisma db execute --stdin <<'SQL'
SELECT 'tags' AS k, COUNT(*) c FROM "SnippetTag"
UNION ALL
SELECT 'assign', COUNT(*) FROM "SnippetTagAssignment";
SQL
```
Expected: SnippetTag 行数 = distinct tag 数；Assignment 行数 = 各未删 snippet tagsJson 标签出现总数（与改前手数对账一致）。

---

### Task 2: tag-repo.ts（server）+ vitest 纯函数

**Files:**
- Create: `src/lib/snippets/tag-repo.ts`
- Create: `tests/unit/snippet-tag-repo.test.ts`

- [ ] **Step 1: 写 `src/lib/snippets/tag-repo.ts`**

```ts
import { prisma } from "@/lib/db";

/** include 片段：带 tag 名。所有读 snippet 的查询复用。 */
export const withTagsInclude = {
  tagAssignments: { include: { tag: { select: { name: true } } } },
} as const;

/** tag 精确过滤谓词（替代 tagsJson contains '"tag"'）。 */
export function tagWhere(name: string) {
  return { tagAssignments: { some: { tag: { name } } } };
}

/** tag 名 contains 搜索谓词（替代 tagsJson contains q）。 */
export function tagSearchWhere(q: string) {
  return { tagAssignments: { some: { tag: { name: { contains: q } } } } };
}

/** 规整 tag 名：trim + 去空 + 去重保序。纯函数。 */
export function normalizeTagNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * serializeSnippet：把 include tagAssignments + omit tagsJson/embedding 的 Prisma 对象
 * 派生成客户端形状 { ...rest, tags: string[] }。tags 按名排序（稳定展示）。
 * 纯函数（无 prisma 调用）——可单测。
 */
export function serializeSnippet<T extends { tagAssignments: { tag: { name: string } }[] }>(
  s: T
): Omit<T, "tagAssignments"> & { tags: string[] } {
  const { tagAssignments, ...rest } = s;
  return {
    ...rest,
    tags: tagAssignments.map((a) => a.tag.name).sort((a, b) => a.localeCompare(b)),
  };
}

/** 找或建单个 tag，返回 id。 */
export async function findOrCreateTagId(name: string): Promise<string> {
  const tag = await prisma.snippetTag.upsert({
    where: { name },
    update: {},
    create: { name },
    select: { id: true },
  });
  return tag.id;
}

/** 找或建多个 tag，返 name→id。 */
export async function findOrCreateTagIds(
  names: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const name of names) {
    out.set(name, await findOrCreateTagId(name));
  }
  return out;
}

/** create/edit：把 snippet 的标签集合精确同步到目标 names（diff：删多补少，事务）。 */
export async function syncSnippetTags(
  snippetId: string,
  names: string[]
): Promise<void> {
  const target = normalizeTagNames(names);
  const targetIds = await findOrCreateTagIds(target);

  const current = await prisma.snippetTagAssignment.findMany({
    where: { snippetId },
    select: { tagId: true, tag: { select: { name: true } } },
  });
  const currentNames = new Set(current.map((c) => c.tag.name));
  const targetSet = new Set(target);

  const toAdd = target.filter((n) => !currentNames.has(n));
  const toRemoveTagIds = current
    .filter((c) => !targetSet.has(c.tag.name))
    .map((c) => c.tagId);

  await prisma.$transaction([
    ...(toRemoveTagIds.length
      ? [
          prisma.snippetTagAssignment.deleteMany({
            where: { snippetId, tagId: { in: toRemoveTagIds } },
          }),
        ]
      : []),
    ...(toAdd.length
      ? [
          prisma.snippetTagAssignment.createMany({
            data: toAdd.map((n) => ({ snippetId, tagId: targetIds.get(n)! })),
          }),
        ]
      : []),
  ]);
}

/** batch：给多个 snippet 加一个 tag（先 select 已有过滤，避 skipDuplicates 不可用）。 */
export async function bulkAddTag(
  snippetIds: string[],
  name: string
): Promise<void> {
  const tagId = await findOrCreateTagId(name);
  const existing = await prisma.snippetTagAssignment.findMany({
    where: { tagId, snippetId: { in: snippetIds } },
    select: { snippetId: true },
  });
  const have = new Set(existing.map((e) => e.snippetId));
  const toCreate = snippetIds.filter((id) => !have.has(id));
  if (toCreate.length) {
    await prisma.snippetTagAssignment.createMany({
      data: toCreate.map((snippetId) => ({ snippetId, tagId })),
    });
  }
}

/** batch：从多个 snippet 移除一个 tag。 */
export async function bulkRemoveTag(
  snippetIds: string[],
  name: string
): Promise<void> {
  const tag = await prisma.snippetTag.findUnique({ where: { name }, select: { id: true } });
  if (!tag) return; // tag 不存在，无操作
  await prisma.snippetTagAssignment.deleteMany({
    where: { tagId: tag.id, snippetId: { in: snippetIds } },
  });
}

/** 标签计数（未删 snippet），替代 collectUniqueTags。count 降序 + name 升序。 */
export async function countTagsByUsage(): Promise<{ name: string; count: number }[]> {
  const tags = await prisma.snippetTag.findMany({
    where: { assignments: { some: { snippet: { trashed: false } } } },
    include: {
      _count: { select: { assignments: { where: { snippet: { trashed: false } } } } },
    },
  });
  return tags
    .map((t) => ({ name: t.name, count: t._count.assignments }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
```

- [ ] **Step 2: 写 vitest** `tests/unit/snippet-tag-repo.test.ts`（仅纯函数；prisma 函数不测）

```ts
import { describe, expect, it } from "vitest";
import {
  serializeSnippet,
  normalizeTagNames,
  tagWhere,
  tagSearchWhere,
} from "@/lib/snippets/tag-repo";

describe("normalizeTagNames", () => {
  it("trim + 去空 + 去重保序", () => {
    expect(normalizeTagNames([" a ", "", "a", "b", " b "])).toEqual(["a", "b"]);
  });
  it("空数组", () => {
    expect(normalizeTagNames([])).toEqual([]);
  });
});

describe("serializeSnippet", () => {
  it("tagAssignments → tags（排序）", () => {
    const out = serializeSnippet({
      id: "1",
      tagAssignments: [{ tag: { name: "b" } }, { tag: { name: "a" } }],
    }) as { tags: string[] };
    expect(out.tags).toEqual(["a", "b"]);
  });
  it("无 tag → tags: []", () => {
    const out = serializeSnippet({ id: "1", tagAssignments: [] }) as { tags: string[] };
    expect(out.tags).toEqual([]);
  });
  it("剥掉 tagAssignments", () => {
    const out = serializeSnippet({ id: "1", tagAssignments: [] }) as Record<string, unknown>;
    expect(out.tagAssignments).toBeUndefined();
  });
});

describe("tagWhere / tagSearchWhere", () => {
  it("tagWhere 精确", () => {
    expect(tagWhere("foo")).toEqual({
      tagAssignments: { some: { tag: { name: "foo" } } },
    });
  });
  it("tagSearchWhere contains", () => {
    expect(tagSearchWhere("foo")).toEqual({
      tagAssignments: { some: { tag: { name: { contains: "foo" } } } },
    });
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `pnpm vitest run tests/unit/snippet-tag-repo.test.ts`
Expected: PASS。

---

### Task 3: 写路径（POST create + PATCH edit）

**Files:**
- Modify: `src/app/api/snippets/route.ts`（POST）
- Modify: `src/app/api/snippets/[id]/route.ts`（PATCH）

- [ ] **Step 1: POST create**

import 加 `{ syncSnippetTags, serializeSnippet, withTagsInclude }` from `@/lib/snippets/tag-repo`。

POST 内：去掉 `tagsJson: JSON.stringify(tags)`。改为：
```ts
  const created = await prisma.snippet.create({
    data: { ...data, title },
    include: withTagsInclude,
  });
  await syncSnippetTags(created.id, tags);
  const snippet = await prisma.snippet.findUniqueOrThrow({
    where: { id: created.id },
    include: withTagsInclude,
    omit: { embedding: true, tagsJson: true },
  });
  // after(...) 用 created.id；aiSummary/embedding/OG 异步不变
  return NextResponse.json({ snippet: serializeSnippet(snippet) }, { status: 201 });
```
> 注：先 create（不含 tagsJson 写入），再 syncSnippetTags，再重查带 include+omit 的对象 serialize。`after(...)` 块原样保留（用 created.id）。

- [ ] **Step 2: PATCH edit**

import 加 syncSnippetTags/serializeSnippet/withTagsInclude。

PATCH 内：`const { tags, ...rest } = parsed.data;` 后，去掉 `if (tags !== undefined) data.tagsJson = ...`。`update` 改 include，tags 变化时同步：
```ts
  const updated = await prisma.snippet.update({
    where: { id },
    data: rest,
    include: withTagsInclude,
    omit: { embedding: true, tagsJson: true },
  });
  if (tags !== undefined) {
    await syncSnippetTags(id, tags);
  }
  const snippet = tags !== undefined
    ? await prisma.snippet.findUniqueOrThrow({ where: { id }, include: withTagsInclude, omit: { embedding: true, tagsJson: true } })
    : updated;
  // inputChanged / after(...) 逻辑原样保留（用 id / updated 字段对比 → 改为对比 existing vs rest，见下）
  return NextResponse.json({ snippet: serializeSnippet(snippet) });
```
> `inputChanged` 判定里原本比对 `rest.linkUrl` 等，不涉及 tagsJson，保留即可（tagsJson 已不在 rest）。返回 serializeSnippet(snippet)。

- [ ] **Step 3: typecheck（预期此时 client 仍用 tagsJson，可能报错——T6 修）**

Run: `pnpm typecheck`
Expected: 可能有 client 端 tagsJson/tags 不匹配错误（T6 统一修）；**本 task 只确保服务端代码自身类型自洽**。

---

### Task 4: 读路径（list/search/load/refetch-og/全局 search/tags 计数/page）

**Files:**
- Modify: `src/app/api/snippets/route.ts`（GET）
- Modify: `src/app/api/snippets/search/route.ts`
- Modify: `src/app/api/snippets/load/route.ts`
- Modify: `src/app/api/snippets/[id]/refetch-og/route.ts`
- Modify: `src/app/api/search/route.ts`
- Modify: `src/lib/snippets/search-result.ts`
- Modify: `src/app/api/snippets/tags/route.ts`（GET 计数）
- Modify: `src/app/snippets/page.tsx`

- [ ] **Step 1: GET /api/snippets（list）**

import 加 serializeSnippet/withTagsInclude/tagWhere/tagSearchWhere。`where` 构造改为：
```ts
  if (tag) Object.assign(where, tagWhere(tag));
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { content: { contains: q } },
      tagSearchWhere(q),
    ];
  }
```
`findMany` 加 `include: withTagsInclude`（与现有 `omit: { embedding: true }` 并列改 `omit: { embedding: true, tagsJson: true }`）。语义补充那次 findMany 同样加 include+omit。返回前 `merged = merged.map(serializeSnippet)`（或对 snippets 与 semSnippets 分别 serialize 再 merge——保持 mergeKeywordAndSemantic 入参为 serialize 后对象，其字段 id 仅用 id，无碍）。最终 `NextResponse.json({ snippets: merged.map(serializeSnippet), nextCursor })`。

> mergeKeywordAndSemantic 按 id/score 合并，不依赖 tagsJson 字段——serialize 后传入安全。

- [ ] **Step 2: /api/snippets/search（@面板）**

`where` 同 Step1（tag→tagWhere，q→tagSearchWhere）。两次 findMany 的 `select: { ...tagsJson... }` 改为 `include: withTagsInclude` + 保留其它 select 字段（select 与 include 同表不能混用 Prisma 顶层 select+include 关系 → 改为不用顶层 select，改用 include 关系字段 + omit；或保留 select 并加 `tagAssignments: { include: { tag: { select: { name: true } } } }` 到 select 内）。

> 实施抉择：`select` 内可直接选关系 `tagAssignments: { include: { tag: { select: { name: true } } } }`，与其它字段并列。采用此法（不动顶层 select）。

`items` 映射：`tags: JSON.parse(s.tagsJson)` → `tags: s.tagAssignments.map(a => a.tag.name).sort()`。

- [ ] **Step 3: /api/snippets/load（AI 工具）**

`select` 内 `tagsJson: true` → `tagAssignments: { include: { tag: { select: { name: true } } } }`。返回前 `snippets.map(s => ({ ...s, tags: s.tagAssignments.map(a=>a.tag.name) }))`（剥 tagAssignments）。契约变更：tagsJson→tags（外部 AI 工具自适应 JSON）。

- [ ] **Step 4: refetch-og**

`findUnique({ where:{id}, omit:{embedding:true} })` → 加 `include: withTagsInclude` + `omit: { embedding:true, tagsJson:true }`；返回 `serializeSnippet(snippet)`。

- [ ] **Step 5: /api/search + search-result.ts**

`/api/search` 的 snippet findMany `select: { ..., tagsJson: true }` → 改 include tagAssignments（select 内选关系）。过滤 `match(s.tagsJson)` → 改为不在此过滤（relation 难以纯客户端 match）或改为 `match` 仅对 title/content；tag 匹配下放给 `snippetToSearchResultItem` 产出的 tags 由消费方处理。

> 简化：`/api/search` 的 `match(s.tagsJson)` 这条移除（tag 命中由 q 走 tagSearchWhere 在 DB 层，或保留 title/content match）。`snippetToSearchResultItem(s)` 入参改为带 `tags: string[]`（由 s.tagAssignments 派生），其内部如使用 tags 则用入参。

读 `src/lib/snippets/search-result.ts` 现状，把 `tagsJson` 读取改为依赖入参 `tags: string[]`（在 /api/search 调用前 map 出来）。

- [ ] **Step 6: /api/snippets/tags GET（计数）**

import `countTagsByUsage` from tag-repo。去掉 `findMany select tagsJson + collectUniqueTags`。改为：
```ts
  const [tagCounts, tagColors] = await Promise.all([countTagsByUsage(), getTagColors()]);
  const tags = tagCounts.map((t) => ({ ...t, color: tagColors[t.name] ?? null }));
  return NextResponse.json({ tags });
```

- [ ] **Step 7: page.tsx 计数**

import `countTagsByUsage`。去掉 `allSnippets` 那次 `findMany({ select:{tagsJson:true} })` + `collectUniqueTags(allSnippets)`。改为 `const tags = await countTagsByUsage();` 再合并 `getTagColors`。`totalCount` 改为 `await prisma.snippet.count({ where:{ trashed:false } })`（原 allSnippets.length）。首屏 `snippets` findMany 保持（加 `omit:{embedding:true, tagsJson:true}` + `include: withTagsInclude`）并 `serializeSnippet` 后传 SnippetsView。

- [ ] **Step 8: typecheck + build（client 未改前可能仍报 tagsJson）**

Run: `pnpm typecheck`
Expected: 仅 client 端 tagsJson→tags 不匹配错误（T6 修）；服务端自洽。

---

### Task 5: batch tag ops → bulk

**Files:**
- Modify: `src/app/api/snippets/batch/route.ts`
- Modify: `src/lib/snippets/batch-ops.ts`（退役 parseTags/collectTagsUnion）

- [ ] **Step 1: batch 路由 addTag/removeTag 分支**

import `bulkAddTag, bulkRemoveTag` from tag-repo；去掉 `parseTags/mergeTag/removeTag` import（路由不再用）。

addTag 分支：`await bulkAddTag(foundIds, tag)`。removeTag 分支：`await bulkRemoveTag(foundIds, tag)`。删掉 `$transaction` read-modify-write 循环。

- [ ] **Step 2: batch-ops.ts 退役旧函数**

`parseTags` / `collectTagsUnion` 不再被任何点引用（client 改用 `s.tags`；server 用 countTagsByUsage）→ 删除。保留 `mergeTag/removeTag/diffTagSets/applyTagDeltas/resolvePinToggle/validateBatchBody/dedupeIds/MAX_TAGS/MAX_TAG_LEN`（client 乐观 delta 仍用）。

同步删 `tests/unit/snippet-batch-ops.test.ts` 里 `parseTags` / `collectTagsUnion` 的测试块。

- [ ] **Step 3: vitest + typecheck**

Run: `pnpm vitest run tests/unit/snippet-batch-ops.test.ts && pnpm typecheck`
Expected: batch-ops 测试通过（删掉的用例不再跑）；剩余 typecheck 错误仅 client tagsJson（T6）。

---

### Task 6: 客户端 tagsJson → tags（types + 组件）

**Files:**
- Modify: `src/components/snippets/types.ts`
- Modify: `src/components/snippets/SnippetCard.tsx`
- Modify: `src/components/snippets/SnippetsView.tsx`
- Modify: `src/components/snippets/SnippetEditInline.tsx`
- Modify: `src/components/editor/SnippetInsertPanel.tsx`

- [ ] **Step 1: types.ts**

`tagsJson: string;` → `tags: string[];`。

- [ ] **Step 2: SnippetCard**

`const tags: string[] = JSON.parse(snippet.tagsJson || "[]");` → `const tags: string[] = snippet.tags;`。

- [ ] **Step 3: SnippetsView**

- `parseTags(s.tagsJson)` 全部 → `s.tags`（6 处：handleDeleted delta、handleBatch addTag/removeTag before、过滤 snippetMatchesAllTags、handleCreated newTags、handleDeleted delTags）。
- `handleBatch` 乐观：`return { ...s, tagsJson: JSON.stringify(after) };` → `return { ...s, tags: after };`。
- removeCandidates：`collectTagsUnion(selectedSnippets)` → `selectedSnippets.flatMap(s => s.tags)` 去重保序（内联或抽小函数）。删 `collectTagsUnion` import。
- 删 `parseTags` import（来自 batch-ops，已退役）。

- [ ] **Step 4: SnippetEditInline**

`parseTags(snippet.tagsJson)` → `snippet.tags`（删本地 parseTags 若有）。

- [ ] **Step 5: SnippetInsertPanel**

`parseTags(s.tagsJson)` → `s.tags`；删本地 `parseTags` 函数（line 51-57）。

- [ ] **Step 6: 全量 gate**

Run: `pnpm typecheck && pnpm build && pnpm lint && pnpm vitest run`
Expected: 0 error / ✓ Compiled / lint 0 error / 全测试通过。

- [ ] **Step 7: grep 残留**

Run: `grep -rnE "tagsJson" src/components/ src/lib/snippets/ src/app/snippets/ src/app/api/snippets/ src/app/api/search/ src/components/editor/ | grep -v "generated"`
Expected: 仅 schema 相关注释/其它模型（Article/Asset/Space）残留，无 snippet 读写点。

- [ ] **Step 8: 手测**（见 spec 验收）
1. 迁移对账（T1 已做）。
2. 建带 tag 的 snippet → DB 落 SnippetTag+Assignment；返回 tags:string[]。
3. /snippets 侧栏计数一致；筛选精准。
4. 搜「art」不再命中含「smart」标签。
5. @面板搜索、批量加/移除标签、删除计数同步、导出、颜色——全工作。
6. 桌面端全功能回归。

---

## Self-Review

**1. Spec 覆盖：** schema+migration+回填（T1）✓ · tag-repo（T2）✓ · 写路径 POST/PATCH（T3）✓ · 读路径 list/search/load/refetch/全局search/tags计数/page（T4）✓ · batch→bulk + 退役 parseTags/collectTagsUnion（T5）✓ · client tagsJson→tags 全点（T6）✓ · tagsJson 保留（不 DROP）✓ · 颜色 store 零改 ✓。

**2. 客户端安全：** tag-repo 仅服务端；client 仅 `tags:string[]`，零 prisma。grep 残留验证。

**3. SQLite 约束：** createMany 不 skipDuplicates → bulkAddTag 先 select 过滤 ✓。migration `json_each`/`randomblob` 依赖 SQLite 3.45+（better-sqlite3 自带）。

**4. 契约 breaking 协调：** T3-T6 间 typecheck 暂时报错（正常），最终 T6 gate 一次性绿。

**5. 回滚安全：** tagsJson 保留；若新代码出问题，数据仍在 tagsJson（虽停写，迁移时刻快照）。

**6. Placeholder：** migration 回填 SQL / repo 函数 verbatim；路由「实施抉择」给了确定性方案（select 内选关系）。

## Execution Handoff

Plan 完成并落盘 `docs/superpowers/plans/2026-07-08-snippets-p4-tag-table.md`。**Inline 执行**，T1 → T2 → T3 → T4 → T5 → T6（T3-T6 协调一次最终 gate）。
