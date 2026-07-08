# 回收站「灵感」支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已删除的灵感（Snippet）在 `/recycle` 可见、可恢复、可彻底删除，并与 文章/空间/素材 一致地 30 天自动清理——闭合当前「移入回收站，可找回」的未兑现承诺。

**Architecture:** 镜像现有回收站模式：`Snippet` 加 nullable `expiresAt` 列；删除路径设 `now+30d`；`lib/recycle.ts` 加 `purgeSnippet` + 扩展 `cleanupExpired`；restore/purge API 加 `snippet` type；recycle page + GET API 透传 trashed snippets；`RecycleBin` 加第 4 个 flat section（非 tab，保桌面零回归）。

**Tech Stack:** Next.js 16 App Router · Prisma 7 + better-sqlite3（SQLite 3.45+，支持 `datetime(col, '+30 days')`）· React + TypeScript · vitest。

## Global Constraints

- **桌面端零回归**（用户硬约束）：所有 UI 改动只能是「新增 section / 新增 type 分支」，不得改动既有 article/space/asset 的渲染与逻辑；回收站桌面端逐像素不变。移动端兼容不在本轮范围。
- **客户端禁 Node 依赖链**：`RecycleBin.tsx` 是 `"use client"`，其 import 链不得拉 prisma/better-sqlite3。新增的 `pickSnippetLabel` 必须放在无 Node 依赖的纯模块。
- **提交策略**（用户 no-auto-commit 偏好，覆盖 skill 默认逐 task commit）：执行期间**不**逐 task commit，所有改动在用户明确说「提交」时统一拆 docs/feat 提交，**不 push**。
- **数据变更唯一入口是 migration 文件**（CLAUDE.md）：既有已删灵感的 `expiresAt` 回填必须写在 `migration.sql` 里，不得另跑 init 脚本 mutate。
- **Prisma 7 命令需 `DATABASE_URL="file:./dev.db"`**（无 .env，dev DB 为 `./dev.db`）。
- **migration 时间戳必须晚于 `20260710000000_snippet_tag_table`**（P4-21 踩过排序 bug）。本计划手写 `20260711000000`，无需后续改名。
- **SQLite Prisma `createMany` 不支持 `skipDuplicates`**（本轮不涉及，仅作上下文）。
- 30 天保留期常量与 `articles/[id]/route.ts:108` 逐字一致：`30 * 24 * 60 * 60 * 1000`。

---

## Task 1: Snippet 加 expiresAt 列 + migration 回填

**Files:**
- Modify: `prisma/schema.prisma`（`Snippet` model，`trashedAt` 之后）
- Create: `prisma/migrations/20260711000000_snippet_expires_at/migration.sql`
- Create: `scripts/verify-snippet-expires.ts`（临时对账，验完即删）

**Interfaces:**
- Produces: `Snippet.expiresAt: DateTime | null`（Prisma client 重新生成后类型可用）

- [ ] **Step 1: 备份 dev.db（回滚保险）**

```bash
cp dev.db dev.db.bak.recycle
```

- [ ] **Step 2: schema.prisma 加列**

在 `Snippet` model 的 `trashedAt   DateTime?` 行之后插入：

```prisma
  trashedAt   DateTime?
  expiresAt   DateTime?   // 回收站过期时间（trashed 时置 now+30d；恢复/清理时清空）
```

- [ ] **Step 3: 手写 migration.sql（ALTER + 回填 UPDATE）**

创建 `prisma/migrations/20260711000000_snippet_expires_at/migration.sql`：

```sql
-- Snippet.expiresAt：与 Article/Space/Asset 对齐的回收站过期时间
ALTER TABLE "Snippet" ADD COLUMN "expiresAt" DATETIME;

-- 回填既有已删灵感：以删除时刻起算 30 天过期（与新增删除路径语义一致）
UPDATE "Snippet"
SET "expiresAt" = datetime("trashedAt", '+30 days')
WHERE "trashed" = 1 AND "expiresAt" IS NULL AND "trashedAt" IS NOT NULL;
```

- [ ] **Step 4: 应用 migration + 重新生成 client**

```bash
DATABASE_URL="file:./dev.db" pnpm prisma migrate deploy
DATABASE_URL="file:./dev.db" pnpm prisma generate
```

Expected: migrate deploy 输出 applying `20260711000000_snippet_expires_at`；generate 无报错。

- [ ] **Step 5: 对账回填——临时 tsx 脚本**

创建 `scripts/verify-snippet-expires.ts`（镜像 `scripts/init-production.ts` 的 prisma 初始化方式；如该路径用 `@/lib/db` 则直接 import）：

```ts
import { prisma } from "../src/lib/db";

async function main() {
  const trashed = await prisma.snippet.findMany({
    where: { trashed: true },
    select: { id: true, title: true, trashedAt: true, expiresAt: true },
  });
  console.log("trashed snippets:", trashed.length);
  for (const s of trashed) {
    const ok = s.expiresAt !== null;
    console.log(ok ? "OK " : "MISS", s.id, s.trashedAt?.toISOString(), s.expiresAt?.toISOString());
  }
  const miss = trashed.filter((s) => s.expiresAt === null && s.trashedAt !== null);
  console.log(miss.length === 0 ? "BACKFILL OK" : `BACKFILL MISS: ${miss.length}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run: `pnpm tsx scripts/verify-snippet-expires.ts`
Expected: 若 dev.db 有已删灵感 → 全部 `OK` + `BACKFILL OK`；若无已删灵感 → `trashed snippets: 0`（也算通过）。

- [ ] **Step 6: 删除临时脚本**

```bash
rm scripts/verify-snippet-expires.ts
```

- [ ] **Step 7: typecheck 确认 client 类型更新**

```bash
pnpm typecheck
```
Expected: 0 errors（`expiresAt` 已在 Snippet 类型上可用）。

---

## Task 2: pickSnippetLabel 纯函数（TDD）

回收站行标题回退逻辑：优先 title → content 首个非空行截断 40 → 占位。提取为纯函数便于测 + 客户端可 import。

**Files:**
- Create: `src/lib/snippets/snippet-label.ts`
- Test: `tests/unit/snippet-label.test.ts`

**Interfaces:**
- Produces: `pickSnippetLabel(title: string, content: string): string`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/snippet-label.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { pickSnippetLabel } from "@/lib/snippets/snippet-label";

describe("pickSnippetLabel", () => {
  it("title 非空直接返回", () => {
    expect(pickSnippetLabel("我的标题", "任何内容")).toBe("我的标题");
  });
  it("title 仅空白时回退到 content 首个非空行", () => {
    expect(pickSnippetLabel("   ", "\n  \n第二行内容")).toBe("第二行内容");
  });
  it("title 空时取 content 首行", () => {
    expect(pickSnippetLabel("", "首行\n第二行")).toBe("首行");
  });
  it("content 首行超过 40 字截断", () => {
    const long = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十1234567890";
    expect(pickSnippetLabel("", long)).toBe(long.slice(0, 40));
  });
  it("title 与 content 均空 → 占位", () => {
    expect(pickSnippetLabel("", "")).toBe("（无内容）");
    expect(pickSnippetLabel("   ", "\n  \n")).toBe("（无内容）");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/snippet-label.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

创建 `src/lib/snippets/snippet-label.ts`：

```ts
/**
 * 回收站行标题回退：title → content 首个非空行（截断 40）→ 占位。
 * 纯函数，无副作用，客户端可安全 import（不拉 Node 依赖）。
 */
export function pickSnippetLabel(title: string, content: string): string {
  const t = title?.trim();
  if (t) return t;
  const firstLine = content
    ?.split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine) return firstLine.slice(0, 40);
  return "（无内容）";
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/snippet-label.test.ts`
Expected: 5/5 PASS。

---

## Task 3: 删除路径设 expiresAt（单删 + 批删）

与 `src/app/api/articles/[id]/route.ts:108` 的 `30 * 24 * 60 * 60 * 1000` 逐字对齐。

**Files:**
- Modify: `src/app/api/snippets/[id]/route.ts`（DELETE handler，行 102–105）
- Modify: `src/app/api/snippets/batch/route.ts`（delete 分支，行 36–41）

- [ ] **Step 1: 单删 DELETE 设 expiresAt**

`src/app/api/snippets/[id]/route.ts`，将：

```ts
  await prisma.snippet.update({
    where: { id },
    data: { trashed: true, trashedAt: new Date() },
  });
```

改为：

```ts
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 天
  await prisma.snippet.update({
    where: { id },
    data: { trashed: true, trashedAt: now, expiresAt },
  });
```

- [ ] **Step 2: 批删 delete action 设 expiresAt**

`src/app/api/snippets/batch/route.ts`，将 delete 分支：

```ts
      if (body.action === "delete") {
        const now = new Date();
        await prisma.snippet.updateMany({
          where: { id: { in: foundIds } },
          data: { trashed: true, trashedAt: now },
        });
      }
```

改为：

```ts
      if (body.action === "delete") {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 天
        await prisma.snippet.updateMany({
          where: { id: { in: foundIds } },
          data: { trashed: true, trashedAt: now, expiresAt },
        });
      }
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors。

---

## Task 4: lib/recycle.ts 加 purgeSnippet + 扩展 cleanupExpired

**Files:**
- Modify: `src/lib/recycle.ts`

**Interfaces:**
- Produces: `purgeSnippet(id: string): Promise<void>`；`cleanupExpired()` 返回值增加 `snippets: number`。

- [ ] **Step 1: 加 purgeSnippet 导出**

在 `src/lib/recycle.ts` 的 `purgeAsset` 函数之后、`cleanupExpired` 之前插入：

```ts
/** 彻底删除一个灵感：仅删 DB 行（SnippetTagAssignment/SnippetUsage 经 onDelete:Cascade 随主行删除）。
 *  imageAssetId 是无 @relation 的软引用，关联 Asset 为共享资源，此处不触碰。 */
export async function purgeSnippet(id: string) {
  await prisma.snippet.delete({ where: { id } });
}
```

- [ ] **Step 2: 扩展 cleanupExpired**

将 `cleanupExpired` 改为（在 assets 查询后加 snippets 查询，循环 purge，返回值加 snippets）：

```ts
/** 清理所有已过期项（expiresAt <= now）。返回各类型清理数量。 */
export async function cleanupExpired() {
  const now = new Date();
  const [expiredArticles, expiredSpaces, expiredAssets, expiredSnippets] = await Promise.all([
    prisma.article.findMany({
      where: { trashed: true, expiresAt: { lte: now } },
      select: { id: true },
    }),
    prisma.space.findMany({
      where: { trashed: true, expiresAt: { lte: now } },
      select: { id: true },
    }),
    prisma.asset.findMany({
      where: { trashed: true, expiresAt: { lte: now } },
      select: { id: true },
    }),
    prisma.snippet.findMany({
      where: { trashed: true, expiresAt: { lte: now } },
      select: { id: true },
    }),
  ]);

  for (const a of expiredArticles) await purgeArticle(a.id);
  for (const s of expiredSpaces) await purgeSpace(s.id);
  for (const a of expiredAssets) await purgeAsset(a.id);
  for (const s of expiredSnippets) await purgeSnippet(s.id);

  return {
    articles: expiredArticles.length,
    spaces: expiredSpaces.length,
    assets: expiredAssets.length,
    snippets: expiredSnippets.length,
  };
}
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors。

---

## Task 5: restore + purge API 加 snippet type

**Files:**
- Modify: `src/app/api/recycle/restore/route.ts`
- Modify: `src/app/api/recycle/purge/route.ts`

- [ ] **Step 1: restore 加 snippet 分支**

`src/app/api/recycle/restore/route.ts`：

(1) schema 的 type enum 加 `"snippet"`：

```ts
const schema = z.object({
  type: z.enum(["article", "space", "asset", "snippet"]),
  id: z.string().min(1),
});
```

(2) 在 `// asset` 分支之前插入 snippet 分支（灵感不嵌套在空间，无条件恢复）：

```ts
  if (type === "snippet") {
    await prisma.snippet.update({
      where: { id },
      data: { trashed: false, trashedAt: null, expiresAt: null },
    });
    logMutation("recycle", "restore", { type, id });
    return NextResponse.json({ ok: true });
  }
```

- [ ] **Step 2: purge 加 snippet 分支**

`src/app/api/recycle/purge/route.ts`：

(1) itemType enum 加 `"snippet"`：

```ts
const itemType = z.enum(["article", "space", "asset", "snippet"]);
```

(2) `purgeOne` 加分支（更新类型签名 + import `purgeSnippet`）：

```ts
import { purgeArticle, purgeAsset, purgeSpace, purgeSnippet } from "@/lib/recycle";

async function purgeOne(type: "article" | "space" | "asset" | "snippet", id: string) {
  if (type === "article") await purgeArticle(id);
  else if (type === "space") await purgeSpace(id);
  else if (type === "asset") await purgeAsset(id);
  else await purgeSnippet(id);
}
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors。

---

## Task 6: recycle page + GET API + RecycleBin UI 集成

让 trashed snippets 在 `/recycle` 可见，复用既有 section/Row，桌面端零回归。

**Files:**
- Modify: `src/app/recycle/page.tsx`
- Modify: `src/app/api/recycle/route.ts`（GET）
- Modify: `src/components/recycle/RecycleBin.tsx`

- [ ] **Step 1: GET /api/recycle 返回 snippets**

`src/app/api/recycle/route.ts`，在 `Promise.all` 加 snippets 查询，返回值加 `snippets`：

```ts
export async function GET() {
  const [articles, spaces, assets, snippets] = await Promise.all([
    prisma.article.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: { id: true, title: true, spaceId: true, status: true, trashedAt: true, expiresAt: true },
    }),
    prisma.space.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: { id: true, name: true, trashedAt: true, expiresAt: true },
    }),
    prisma.asset.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: { id: true, name: true, kind: true, url: true, trashedAt: true, expiresAt: true },
    }),
    prisma.snippet.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: { id: true, title: true, content: true, kind: true, trashedAt: true, expiresAt: true },
    }),
  ]);

  return NextResponse.json({ articles, spaces, assets, snippets });
}
```

- [ ] **Step 2: recycle page 查询并透传 snippets**

`src/app/recycle/page.tsx`，`Promise.all` 加 snippets 查询，传给 `RecycleBin`：

```ts
  const [articles, spaces, assets, snippets] = await Promise.all([
    prisma.article.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: { id: true, title: true, spaceId: true, status: true, trashedAt: true, expiresAt: true },
    }),
    prisma.space.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: { id: true, name: true, trashedAt: true, expiresAt: true },
    }),
    prisma.asset.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: { id: true, name: true, kind: true, url: true, trashedAt: true, expiresAt: true },
    }),
    prisma.snippet.findMany({
      where: { trashed: true },
      orderBy: { trashedAt: "desc" },
      select: { id: true, title: true, content: true, kind: true, trashedAt: true, expiresAt: true },
    }),
  ]);
```

return 的 `<RecycleBin>` 加 `snippets={JSON.parse(JSON.stringify(snippets))}`。

- [ ] **Step 3: RecycleBin 加 SnippetItem 类型 + props/state/Type 覆盖**

`src/components/recycle/RecycleBin.tsx`：

(1) import 增加 `Quote, Link`（`FileText`、`Image as ImageIcon` 已有），并 import `pickSnippetLabel`：

```ts
import {
  RotateCcw,
  Trash2,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Quote,
  Link,
  CheckSquare,
  Square,
} from "lucide-react";
import { pickSnippetLabel } from "@/lib/snippets/snippet-label";
```

(2) 在 `AssetItem` 类型之后加：

```ts
type SnippetItem = {
  id: string;
  title: string;
  content: string;
  kind: string;
  trashedAt: string | null;
  expiresAt: string | null;
};
```

(3) `Type` 联合加 `"snippet"`：

```ts
type Type = "article" | "space" | "asset" | "snippet";
```

(4) 组件 props 签名加 `snippets: SnippetItem[]`，解构加 `snippets`：

```ts
export function RecycleBin({
  articles,
  spaces,
  assets,
  snippets,
}: {
  articles: ArticleItem[];
  spaces: SpaceItem[];
  assets: AssetItem[];
  snippets: SnippetItem[];
}) {
  const [items, setItems] = useState({ articles, spaces, assets, snippets });
```

(5) `useEffect` 同步初始数据：

```ts
  useEffect(() => {
    setItems({ articles, spaces, assets, snippets });
  }, [articles, spaces, assets, snippets]);
```

- [ ] **Step 4: RecycleBin 操作函数覆盖 snippet type**

(1) `removeFromList` 加 snippet 分支：

```ts
  function removeFromList(type: Type, id: string) {
    setItems((cur) => {
      if (type === "article")
        return { ...cur, articles: cur.articles.filter((a) => a.id !== id) };
      if (type === "space")
        return { ...cur, spaces: cur.spaces.filter((a) => a.id !== id) };
      if (type === "snippet")
        return { ...cur, snippets: cur.snippets.filter((a) => a.id !== id) };
      return { ...cur, assets: cur.assets.filter((a) => a.id !== id) };
    });
    setSelected((cur) => {
      const next = new Set(cur);
      next.delete(keyOf(type, id));
      return next;
    });
  }
```

(2) `toggleSelectAll` 与 `total` / `allKeys` 三处都补上 snippets：

```ts
  function toggleSelectAll() {
    const allKeys = [
      ...items.articles.map((a) => keyOf("article", a.id)),
      ...items.spaces.map((s) => keyOf("space", s.id)),
      ...items.assets.map((a) => keyOf("asset", a.id)),
      ...items.snippets.map((s) => keyOf("snippet", s.id)),
    ];
    setSelected((cur) => {
      const allSelected = allKeys.every((k) => cur.has(k));
      if (allSelected) {
        const next = new Set(cur);
        for (const k of allKeys) next.delete(k);
        return next;
      }
      return new Set([...cur, ...allKeys]);
    });
  }

  const total =
    items.articles.length + items.spaces.length + items.assets.length + items.snippets.length;
  const allKeys = [
    ...items.articles.map((a) => keyOf("article", a.id)),
    ...items.spaces.map((s) => keyOf("space", s.id)),
    ...items.assets.map((a) => keyOf("asset", a.id)),
    ...items.snippets.map((s) => keyOf("snippet", s.id)),
  ];
  const allSelected = total > 0 && allKeys.every((k) => selected.has(k));
```

- [ ] **Step 5: RecycleBin 顶部文案 + snippet Section 渲染**

(1) 顶部说明文案加「灵感」：

```tsx
          <p className="text-sm text-muted-foreground mt-1">
            删除的文章 / 空间 / 素材 / 灵感暂存于此，
            {cleaning ? "清理中…" : `共 ${total} 项`}。默认保留 30 天，过期自动清理。
          </p>
```

(2) 在「素材」Section 之后、「`</>`」之前插入 snippet Section：

```tsx
          {/* 灵感 */}
          {items.snippets.length > 0 && (
            <Section title="灵感" count={items.snippets.length}>
              {items.snippets.map((s) => (
                <Row
                  key={s.id}
                  selected={selected.has(keyOf("snippet", s.id))}
                  onToggleSelect={() => toggleSelect("snippet", s.id)}
                  icon={snippetIcon(s.kind)}
                  title={pickSnippetLabel(s.title, s.content)}
                  subtitle={s.trashedAt ? `删除于 ${formatDate(s.trashedAt)}` : undefined}
                  daysLeft={daysLeft(s.expiresAt)}
                  onRestore={() => restore("snippet", s.id)}
                  onPurge={() => purge("snippet", s.id)}
                />
              ))}
            </Section>
          )}
```

(3) 在文件末尾（`Row` 组件之后或之前）加 `snippetIcon` 辅助函数：

```tsx
function snippetIcon(kind: string) {
  if (kind === "image") return <ImageIcon className="h-4 w-4 text-muted-foreground" />;
  if (kind === "quote") return <Quote className="h-4 w-4 text-muted-foreground" />;
  if (kind === "link") return <Link className="h-4 w-4 text-muted-foreground" />;
  return <FileText className="h-4 w-4 text-muted-foreground" />;
}
```

注意：lucide 的 `Image` 在此文件已 alias 为 `ImageIcon`，故 `snippetIcon` 内用 `<ImageIcon />`。

- [ ] **Step 6: GET 响应 setItems 适配**

`useEffect`（打开回收站懒清理那段）里 `setItems(data)` 的 guard 保持 `if (data.articles)`（作为「数据已加载」信号即可，snippets 随 `data` 一并写入）。无需改动——确认 `data` 形状已含 snippets 即可（Step 1 已保证）。

- [ ] **Step 7: 全量 gate**

```bash
pnpm typecheck && pnpm build && pnpm lint
pnpm vitest run tests/unit/snippet-label.test.ts
```
Expected: typecheck 0 errors；build 成功；lint 0 errors（既有 warning 不计）；vitest 5/5。

- [ ] **Step 8: 手测清单（用户跑）**

重启 `rm -rf .next && pnpm dev` + 硬刷新：

1. `/snippets` 删除一条灵感 → `/recycle` 出现「灵感」section，显示标题/删除时间/剩余天数。
2. 单条「恢复」→ 灵感回到 `/snippets`（pinned/tags/content 保留），回收站消失。
3. 单条「彻底删除」→ 二次确认后从回收站消失，DB 行真删（关系表 cascade）。
4. 多选 + 批量彻底删除（可与文章/空间/素材混合）→ 全部清除。
5. `/snippets` 批量删除 N 条 → `/recycle` 灵感 section 计数同步。
6. 删除一条后等价检查：DB 中该行 `trashed=1, expiresAt ≈ now+30d`。
7. **桌面端回归**：既有 文章/空间/素材 三 section 渲染与操作逐像素不变。

---

## 收尾（用户说「提交」时执行，不 push）

- `dev.db.bak.recycle` 已 gitignore（不提交）。
- docs commit：`docs(snippets): 回收站「灵感」支持 design spec + implementation plan`（spec + plan 两个文件）。
- feat commit：`feat(snippets): 回收站支持灵感（恢复/彻底删/30天自动清理）`（schema + migration + 6 改 + 2 新）。
