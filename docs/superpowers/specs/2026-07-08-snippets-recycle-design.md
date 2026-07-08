# 回收站「灵感」支持 设计

> 对应 `docs/features/snippets-design.md` §9 集成点：「回收站 — `/recycle` 页面增加「灵感」tab，展示已删除的素材块」。

## 1. 背景 / 问题

灵感（Snippet）的删除是**软删除**：`snippets/[id]` DELETE 与 `snippets/batch` 的 delete action 都只置 `trashed: true` + `trashedAt: now`。但与 文章 / 空间 / 素材 三类回收站对象相比，缺失两环：

1. **没有 `expiresAt`**：其它三类删除时设 `expiresAt = now + 30d`，`cleanupExpired()` 据此懒清理；灵感不设，已删灵感永久留在 DB，从不自动清理。
2. **没有回收站 UI / API**：`/recycle` 页面、`GET/POST /api/recycle`、`restore`、`purge`、`cleanup` 全部硬编码 `article | space | asset`。已删灵感既不可见、也不可恢复、不可彻底删除。

→ `/snippets` 删除时给用户的提示「移入回收站，可找回」是一句**未兑现的承诺**。本设计闭合这个删除闭环。

## 2. 目标

- 已删灵感在 `/recycle` 可见、可单/批量恢复、可单/批量彻底删除。
- 与其它三类一致地 **30 天自动清理**（用户已确认策略）。
- 桌面端既有回收站 UI **零回归**（不重构为 tab，沿用既有 flat section 布局，新增第 4 个 section）。

## 3. 非目标

- 不引入 tab 式回收站（既有是 flat sections，保持一致）。
- 不改变灵感软删除语义本身（仍是 `trashed` 软删，不是真删）。
- 不处理 `imageAssetId` 关联 Asset 的清理（见 §6 边界）。
- 不做「从文章摘录的灵感随文章删除而删除」之类的级联（维持现状）。

## 4. 现状对照

| 维度 | 文章/空间/素材 | 灵感（现状） | 灵感（目标） |
|---|---|---|---|
| 软删字段 | `trashed` + `trashedAt` + `expiresAt` | `trashed` + `trashedAt` | + `expiresAt` |
| 保留期 | 30 天 | 永久 | 30 天 |
| `/recycle` 可见 | 是 | 否 | 是 |
| restore API | 是 | 否 | 是 |
| purge API | 是 | 否 | 是 |
| cleanupExpired | 是 | 否 | 是 |

## 5. 详细设计

### 5.1 数据模型

`prisma/schema.prisma` `Snippet` 新增一列：

```prisma
expiresAt   DateTime?   // 回收站过期时间（trashed 时置 now+30d；恢复时清空）
```

- nullable → 对既有数据无影响（既有已删灵感 `expiresAt IS NULL`，见 §5.6 迁移回填处理）。
- migration 文件夹时间戳必须 **晚于** `20260710000000_snippet_tag_table`（避免重蹈 P4-21 时间戳排序 bug）。

### 5.2 删除路径设 expiresAt

两处删除点，统一改为 `trashed + trashedAt + expiresAt`：

- `src/app/api/snippets/[id]/route.ts` DELETE（单删）
- `src/app/api/snippets/batch/route.ts` delete action（批删）

与 `articles/[id]/route.ts:108` 完全对齐的写法：

```ts
const now = new Date();
const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 天
// ...
data: { trashed: true, trashedAt: now, expiresAt }
```

### 5.3 `src/lib/recycle.ts`

新增 `purgeSnippet(id)`：

```ts
/** 彻底删除一个灵感：仅删 DB 行（关系表 cascade；imageAssetId 是软引用，不动 Asset）。 */
export async function purgeSnippet(id: string) {
  await prisma.snippet.delete({ where: { id } });
}
```

- `SnippetTagAssignment` / `SnippetUsage` 经 `onDelete: Cascade` 自动随主行删除。
- `imageAssetId` 是无 `@relation` 的纯字符串 ID（共享 Asset），purge 灵感**不**触碰 Asset。
- 灵感无外部 OSS / 微信资源（`imageUrl` 多为外链或引用 Asset URL），无需 `purgeAssetResources`。

扩展 `cleanupExpired()`：在现有 articles/spaces/assets 三类之外，加查 `Snippet` 过期项并 `purgeSnippet`，返回值增加 `snippets` 计数。

### 5.4 restore API（`src/app/api/recycle/restore/route.ts`）

- `schema` 的 `type` enum 增加 `"snippet"`。
- 新增 `snippet` 分支：无条件 `prisma.snippet.update({ where: { id }, data: { trashed: false, trashedAt: null, expiresAt: null } })`。
- 灵感不嵌套在空间里，**无** 文章那种「父空间仍在回收站则拒绝」的检查。
- 恢复只清回收字段，`pinned / color / tags / content` 等一律保留。

### 5.5 purge API（`src/app/api/recycle/purge/route.ts`）

- `itemType` enum 增加 `"snippet"`。
- `purgeOne` 增加 `else if (type === "snippet") await purgeSnippet(id)`。
- 单删 / 批删两条路径自动同时支持（共用 `purgeOne`）。

### 5.6 migration：回填既有已删灵感的 expiresAt

既有已删灵感（`trashed=true AND expiresAt IS NULL`）需补 `expiresAt`，否则它们永不自动清理（与「30 天」承诺不符）。回填策略：**以 `trashedAt + 30d` 为过期时间**（等价于「按删除时刻起算 30 天」）。

```sql
UPDATE "Snippet"
SET "expiresAt" = datetime("trashedAt", '+30 days')
WHERE "trashed" = 1 AND "expiresAt" IS NULL AND "trashedAt" IS NOT NULL;
```

- 仅回填 `trashedAt` 非空的行；`trashedAt` 异常为空的已删行不动（边缘情况，cleanupExpired 也不会清，留待手动 purge）。
- 这是**数据补齐**，遵循 CLAUDE.md「数据变更唯一入口是 migration 文件」。

### 5.7 recycle page + GET API

- `src/app/recycle/page.tsx`：`Promise.all` 增加 `prisma.snippet.findMany({ where: { trashed: true }, orderBy: { trashedAt: "desc" }, select: { id, title, content, kind, trashedAt, expiresAt } })`，传给 `RecycleBin` 的 `snippets` prop。
- `GET /api/recycle/route.ts`：同样增加 snippets 查询与返回字段。
- `select` 字段说明：`content` 用于标题回退（title 为空时取首行），`kind` 用于行图标。既有 `Row` 组件无缩略图槽位，**不**取 `imageUrl`（避免范围蔓延与桌面回归风险）。

### 5.8 RecycleBin UI（`src/components/recycle/RecycleBin.tsx`）

- props / state / `items` 类型增加 `snippets: SnippetItem[]`。
- `Type` 联合增加 `"snippet"`；`keyOf` / `removeFromList` / `toggleSelectAll` / `total` / `allKeys` 全部覆盖新类型。
- 新增一个 `<Section title="灵感" count={...}>`，在「素材」section 之后渲染，复用既有 `Row` 组件：
  - `title`：`snippet.title?.trim() || snippet.content.split("\n")[0]?.slice(0, 40) || "（无内容）"`
  - `subtitle`：`删除于 ${formatDate(trashedAt)}`（与其它 section 一致）
  - `icon`：按 `kind` 选 lucide 图标（text→`FileText`、image→`Image`、quote→`Quote`、link→`Link`）
  - `daysLeft` / 恢复 / 彻底删除：完全复用 `Row` 现有逻辑。
- 顶部文案「删除的文章 / 空间 / 素材」→「删除的文章 / 空间 / 素材 / 灵感」。

### 5.9 桌面端零回归

所有改动都是**新增 section / 新增 type 分支**，不改动既有 article/space/asset 的渲染与逻辑。RecycleBin 既有三 section 在桌面端渲染逐像素不变（满足 desktop-first 约束）。

## 6. 边界与决策

- **`imageAssetId` 不级联清理**：灵感引用的 Asset 是共享资源（多个灵感 / 文章可引用同一图），删灵感不应删 Asset。`imageAssetId` 在 schema 中无 `@relation`，purge 灵感时仅删 Snippet 行。
- **过期时刻以删除时刻起算**：回填用 `trashedAt + 30d`，新删用 `now + 30d`，语义一致。
- **无 tab 化**：设计文档原文用「灵感 tab」是泛指，既有 UI 实为 flat sections；遵循 desktop-first / 不重构原则，新增 section 而非引入 tab。

## 7. 测试策略

- **纯函数**（vitest，`tests/unit/`）：标题回退逻辑 `pickSnippetLabel(title, content)`（提取为纯函数便于测）。
- **API / UI**：typecheck + build + 手测（恢复 / 彻底删 / 批量 / 过期清理 / 桌面回归）。
- **migration 回填**：tsx 临时脚本对账（既有已删灵感 `expiresAt` 被正确回填）。

## 8. 风险

- **migration 时间戳排序**：必须晚于 `20260710000000_snippet_tag_table`，否则全新 DB 应用顺序错乱（P4-21 已踩过）。
- **cleanupExpired 性能**：增加一类 findMany，但回收站量级小，可忽略。
- **批量 purge 跨类型**：既有 `purgeBatch` 已支持混合 type（按 `${type}:${id}` 拆），新增 snippet 自动兼容，无需改批删前端逻辑。
