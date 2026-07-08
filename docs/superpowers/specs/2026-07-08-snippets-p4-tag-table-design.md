# 素材块 P4-21（SnippetTag 独立表）设计

> 日期：2026-07-08
> 分支：`feat/snippets-p4-tag-table`（从 `feat/snippets-p4-mobile` 开 stacked 子分支）
> 范围：路线图 P4 的 **item 21**——把 `Snippet.tagsJson`（JSON 串）重构为 `SnippetTag` + `SnippetTagAssignment` 关系表。

## 目标

标签从 JSON blob 升级为正规关系表：索引化查询、精确过滤/搜索（根治 `tagsJson contains` 不精确——搜 "art" 命中 "smart"）、高效计数、为「一处改名」打基础。**桌面端功能行为不变，仅存储层重构。**

## 背景与现状

- `Snippet.tagsJson String @default("[]")`，客户端 `SnippetItem.tagsJson: string` + 各处 `JSON.parse`。
- **写**：POST create / PATCH edit 写 `tagsJson = JSON.stringify(tags)`；batch addTag/removeTag 逐条 read-modify-write tagsJson。
- **读**：GET /api/snippets（list/search）、/api/snippets/search（@面板）、/api/snippets/load（AI 工具）、refetch-og、/api/snippets/tags GET（计数）、/api/search（全局）、page.tsx（计数）。
- **过滤/搜索**：`tagsJson: { contains: '"tag"' }`（不精确）、`tagsJson contains q`。
- **颜色**：`tag-color-store.ts` 存 SystemConfig kv `inkpress.snippetTagColors`，按 tag **name** 索引——与存储解耦。
- 计数：`collectUniqueTags(allSnippets select tagsJson)`（client/server 端解析 JSON 聚合）。

## 关键设计决策（已与用户确认）

1. **API 返回 `tags: string[]`**（服务端从 join 派生），不返回 tag 对象——客户端改动最小（`tagsJson:string`→`tags:string[]`，去 `JSON.parse`）。
2. **tagsJson 列保留**（停读写、作安全网），下轮稳定后再 DROP——桌面应用用户本地 DB，安全优先。
3. **颜色 store 不动**（name 索引继续可用，setTagColor/getTagColors 零改）。
4. **M2M 显式联表**（镜像 SnippetUsage 风格）：`SnippetTag` + `SnippetTagAssignment`。
5. **数据回填走 migration.sql**（遵守 CLAUDE.md「数据变更唯一入口是 migration」）。

## 数据模型

```prisma
model SnippetTag {
  id          String   @id @default(cuid())
  name        String   @unique
  createdAt   DateTime @default(now())
  assignments SnippetTagAssignment[]
}
model SnippetTagAssignment {
  id        String   @id @default(cuid())
  snippetId String
  tagId     String
  createdAt DateTime @default(now())
  snippet   Snippet   @relation(fields: [snippetId], references: [id], onDelete: Cascade)
  tag       SnippetTag @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@index([snippetId])
  @@index([tagId])
  @@unique([snippetId, tagId])
}
```
`Snippet` 追加 `tagAssignments SnippetTagAssignment[]`。`tagsJson` 列保留（schema 里留字段、标废弃注释）。

## 架构

```
写：POST/PATCH → syncSnippetTags(id, names)（find-or-create tag + diff 同步 assignment）
         batch addTag/removeTag → bulkAddTag/bulkRemoveTag（find-or-create + createMany/deleteMany）
读：findMany include tagAssignments.tag + omit tagsJson,embedding → serializeSnippet → { ...s, tags: string[] }
过滤/搜索：tag → { tagAssignments: { some: { tag: { name } } } }
          q 搜 tag → { tagAssignments: { some: { tag: { name: { contains: q } } } } }
计数：countTagsByUsage()（groupBy/_count，where snippet.trashed=false）→ 替代 collectUniqueTags
```

### 模块布局

| 文件 | 改动 |
|---|---|
| `prisma/schema.prisma`（改） | 加 SnippetTag + SnippetTagAssignment + Snippet.tagAssignments；tagsJson 标废弃 |
| `prisma/migrations/<ts>_snippet_tag_table/migration.sql`（新） | CREATE 两表+索引+FK + json_each 回填 tag/assignment（**不 DROP tagsJson**） |
| `src/lib/snippets/tag-repo.ts`（新，server-only） | `findOrCreateTagIds` / `syncSnippetTags` / `bulkAddTag` / `bulkRemoveTag` / `countTagsByUsage` / `serializeSnippet` / `withTagsInclude` / `tagWhere` |
| `src/lib/snippets/search-result.ts`（改） | `snippetToSearchResultItem`：tagsJson → 入参带 tags |
| `src/lib/snippets/batch-ops.ts`（改） | 退役 `parseTags` / `collectTagsUnion`（改签名或删）；保留 mergeTag/removeTag/diffTagSets/applyTagDeltas/resolvePinToggle/validateBatchBody/dedupeIds |
| `src/lib/snippets/tag-filter.ts`（改） | 退役 `collectUniqueTags`（服务端 countTagsByUsage 替代）；`snippetMatchesAllTags` 保留 |
| `src/app/api/snippets/route.ts`（改） | POST syncSnippetTags+serialize；GET include+omit+serialize+relation 过滤 |
| `src/app/api/snippets/[id]/route.ts`（改） | PATCH syncSnippetTags+serialize |
| `src/app/api/snippets/[id]/refetch-og/route.ts`（改） | 返回 serialize |
| `src/app/api/snippets/search/route.ts`（改） | include+serialize+relation 过滤（@面板） |
| `src/app/api/snippets/load/route.ts`（改） | include；返回 `tags: string[]`（外部 AI 工具契约变更） |
| `src/app/api/snippets/batch/route.ts`（改） | addTag/removeTag → bulkAddTag/bulkRemoveTag |
| `src/app/api/snippets/tags/route.ts`（改） | GET countTagsByUsage（替代 collectUniqueTags）；PATCH 不变 |
| `src/app/api/search/route.ts`（改） | snippet tags 匹配走 relation；select 改 include |
| `src/app/snippets/page.tsx`（改） | 标签计数用 countTagsByUsage（服务端） |
| `src/components/snippets/types.ts`（改） | `tagsJson: string` → `tags: string[]` |
| `src/components/snippets/SnippetCard.tsx`（改） | `JSON.parse(tagsJson)` → `s.tags` |
| `src/components/snippets/SnippetsView.tsx`（改） | `parseTags(s.tagsJson)`→`s.tags`（6 处）；乐观 `tagsJson:JSON.stringify`→`tags:after` |
| `src/components/snippets/SnippetEditInline.tsx`（改） | `parseTags(snippet.tagsJson)` → `snippet.tags` |
| `src/components/editor/SnippetInsertPanel.tsx`（改） | `parseTags(s.tagsJson)` → `s.tags`；删本地 parseTags |
| `tests/unit/snippet-tag-repo.test.ts`（新） | serializeSnippet / tagWhere / 名字规整等纯函数 |

**客户端安全**：`tag-repo.ts` 仅服务端（import prisma）；客户端只拿 `tags: string[]`，零 prisma 入 bundle。

## 行为规约

### Migration 回填（`<ts>_snippet_tag_table/migration.sql`）

Prisma `--create-only` 生成 CREATE 两表 + 索引 + FK；手填追加：
```sql
-- 回填 distinct tag
INSERT OR IGNORE INTO "SnippetTag" (id, name)
SELECT lower(hex(randomblob(16))), j.value FROM (
  SELECT DISTINCT je.value AS value
  FROM "Snippet", json_each("Snippet"."tagsJson") AS je
  WHERE je.value IS NOT NULL AND length(CAST(je.value AS TEXT)) > 0
) AS j;

-- 回填 assignment（INSERT OR IGNORE 容忍同 snippet 重复 tag）
INSERT OR IGNORE INTO "SnippetTagAssignment" (id, snippetId, tagId)
SELECT lower(hex(randomblob(16))), s.id, t.id
FROM "Snippet" s, json_each(s."tagsJson") AS je
JOIN "SnippetTag" t ON t.name = je.value
WHERE je.value IS NOT NULL AND length(CAST(je.value AS TEXT)) > 0;
```
不 DROP tagsJson。流程：改 schema → `prisma migrate dev --create-only --name snippet_tag_table` → 编辑 sql 追加回填 → `prisma migrate deploy && prisma generate`。better-sqlite3 自带 SQLite 3.45+ 支持 `json_each`/`randomblob`。

### tag-repo（`src/lib/snippets/tag-repo.ts`）

- `findOrCreateTagIds(names: string[]): Promise<Map<string,string>>` — 对每个 trimmed 非空 name，`upsertMany`（或逐个 upsert）by name，返 name→id。
- `syncSnippetTags(snippetId, names: string[])` — 现有 assignment vs 目标 names 的 diff：删多余的、加缺失的（事务）。create/edit 用。
- `bulkAddTag(snippetIds: string[], name)` — find-or-create tag id → `createMany` assignments（`skipDuplicates` 不可用 → 先查已有过滤，或 catch unique）。batch 用。
- `bulkRemoveTag(snippetIds: string[], name)` — 查 tag id → `deleteMany({ where: { snippetId:{in}, tagId } })`。
- `countTagsByUsage(): Promise<{name,count}[]>` — `snippetTag.findMany({ where: { assignments: { some: { snippet: { trashed:false } } } }, include: { _count: ... } })` → map/sort（count 降序 + name 升序）。
- `serializeSnippet(s)` — 入参为 `include tagAssignments.tag` + `omit tagsJson,embedding` 的 Prisma 对象；出 `{ ...s, tags: tagAssignments.map(a=>a.tag.name).sort() }`。
- `withTagsInclude` = `{ tagAssignments: { include: { tag: { select: { name: true } } } } }` 常量。
- `tagWhere(name)` = `{ tagAssignments: { some: { tag: { name } } } }`；`tagSearchWhere(q)` = `{ tagAssignments: { some: { tag: { name: { contains: q } } } } }`。

### 路由

- POST create：`const s = await prisma.snippet.create({ data: { ...rest }, include: withTagsInclude })`；`await syncSnippetTags(s.id, tags)`；重查+serialize 返回。
- PATCH edit：tags 变化时 `await syncSnippetTags(id, tags)`；include 重查+serialize。
- GET list：`tag`/`q` 走 relation；`include withTagsInclude`+`omit tagsJson,embedding`；map serializeSnippet。
- /search、/load、refetch-og：include+serialize（load 返回 `{ ...rest, tags }`）。
- batch：addTag→`bulkAddTag(foundIds, tag)`；removeTag→`bulkRemoveTag(foundIds, tag)`；删 read-modify-write。
- /tags GET：`countTagsByUsage()` + 合并 getTagColors。
- /api/search：snippet 查询 select→include tagAssignments；匹配 tag 走 relation 或客户端用 tags；`snippetToSearchResultItem` 入参带 tags。

### 客户端

- `SnippetItem.tagsJson: string` → `tags: string[]`。
- SnippetCard/SnippetsView/SnippetEditInline/SnippetInsertPanel：去 `JSON.parse`/本地 parseTags，直接 `s.tags`。
- SnippetsView 乐观更新：`{ ...s, tagsJson: JSON.stringify(after) }` → `{ ...s, tags: after }`；`parseTags(s.tagsJson)` → `s.tags`。
- page.tsx：`collectUniqueTags(allSnippets)` → `await countTagsByUsage()`（去掉 allSnippets 全量 select）。

## 错误处理

- syncSnippetTags/bulk 事务失败 → 路由 500。
- find-or-create by name：name 唯一约束，并发 upsert 安全（`upsert` 或 `createMany skipDuplicates` 不可用则先 select 已有 id）。
- 回填后 tagsJson 保留 → 任何遗漏的旧读点会拿到 stale 数据；typecheck 兜底确保所有读点已迁移（tagsJson 仅在 schema/生成代码/其他模型留存）。

## 测试边界

vitest 覆盖 tag-repo 纯函数：`serializeSnippet`（tags 派生/排序/空）、`tagWhere`/`tagSearchWhere` 构造、名字 trim/去空。**不**进 vitest：prisma 查询、路由、migration、组件——走 typecheck + build + 手测。migration 回填正确性手测（迁移后 `SELECT count(*) FROM SnippetTagAssignment` vs 原 tagsJson 标签总数对账）。

## 验收

1. 迁移后：SnippetTag 行数 = distinct tag 数；SnippetTagAssignment 行数 = 所有未删 snippet 的标签出现总数（对账 tagsJson）。
2. 创建/编辑带 tag 的 snippet → DB 落 SnippetTag + Assignment；返回 `tags: string[]`。
3. /snippets 标签侧栏计数与改前一致；筛选精准（不再 contains 误命中）。
4. 搜索「art」不再命中含「smart」标签的素材（relation 精确）。
5. @面板搜索、批量加/移除标签、删除（标签计数同步）全工作。
6. 客户端无 `JSON.parse(tagsJson)` 残留（grep 验证）；`tagsJson` 仅 schema/生成代码/其他模型。
7. 桌面端全功能回归（创建/编辑/筛选/搜索/批量/导出/颜色）与改前一致。

## 范围外

- DROP tagsJson 列（下轮）。
- 颜色迁移到 SnippetTag 列（保留 tag-color-store）。
- tag 重命名 UI（关系表已 enable，UI 另做）。
- 其它模型（Space/Asset/Article）的 tagsJson。
