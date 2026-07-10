# Tasks Phase B 实现计划：空间导航 + 彩色标签 + 任务垃圾箱

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任务支持按空间（文件夹）导航、用全局彩色标签分类、以及可恢复的软删除垃圾箱（30 天自动清理），三个特性一次交付。

**Architecture:** 新增 `Tag` + `TaskTag` 多对多关联表，给 `Task` 加软删除三件套（`trashed`/`trashedAt`/`expiresAt`）。API 层 `DELETE` 改软删、新增 restore/purge 端点、新增 Tag CRUD、新增任务计数控件。前端在 `/tasks` 页加左侧 `TaskSidebar`（空间列表 + 收集箱 + 垃圾箱 + 标签管理入口），`TaskItem` 展示彩色标签并支持 `TagPicker` Popover 赋值。

**Tech Stack:** Next.js 16 / React 19 / Prisma 7 + SQLite / vitest / shadcn/ui + Tailwind / lucide-react。

## Global Constraints

- 标签仅用于任务，不触碰 `Space.tagsJson` / `Article.tagsJson`。
- 软删除字段语义与 Space/Article 一致：`trashed` 标记、`trashedAt` 时间戳、`expiresAt = trashedAt + 30 天`。
- 过期清理走懒清理（GET 查询时 `deleteMany` 已过期记录），不引入 cron。
- `tagsJson` 保留只读兼容，迁移后新读写全部走 `TaskTag` 关联表。
- 所有 Prisma CLI 命令必须显式带 `DATABASE_URL="file:./dev.db"`（项目根的 `./dev.db` 是真实开发库，`.env` 未设置此变量）。
- 中文 UI 文案；组件遵循 shadcn/ui + Tailwind 既有风格。
- 已有 UI 原语：`@/components/ui/{dialog,popover,button,input,label,confirm-dialog,badge,select}`。
- Prisma 序列化桥接：Prisma 返回嵌套 `tags: [{ tag: {...} }]`，前端 `Task.tags` 期望扁平 `[{ id, name, color }]`，在 GET 响应里做扁平化映射。

---

## 文件结构

**新建：**
- `prisma/migrations/<timestamp>_task_phase_b_tags_trash/migration.sql` — DDL + 数据迁移
- `src/app/api/tags/route.ts` — Tag GET/POST
- `src/app/api/tags/[id]/route.ts` — Tag PATCH/DELETE
- `src/app/api/tasks/[id]/restore/route.ts` — 恢复任务
- `src/app/api/tasks/[id]/purge/route.ts` — 彻底删除
- `src/app/api/tasks/counts/route.ts` — 侧边栏计数控件
- `src/lib/tasks/trash-lifecycle.ts` — 软删除纯函数
- `src/lib/tasks/tag-colors.ts` — 标签颜色常量/工具
- `src/components/tasks/TagPicker.tsx` — 共享标签多选 Popover
- `src/components/tasks/TagManageDialog.tsx` — 标签管理弹窗
- `src/components/tasks/TrashView.tsx` — 垃圾箱视图
- `src/components/tasks/TaskSidebar.tsx` — 左侧空间/垃圾箱导航
- `tests/unit/task-trash-lifecycle.test.ts`
- `tests/unit/task-tag-colors.test.ts`

**修改：**
- `prisma/schema.prisma` — Tag、TaskTag 模型；Task 软删字段 + 反向关联
- `src/app/api/tasks/route.ts` — GET 扁平化 tags/默认排除 trashed/trashed root/懒清理；POST 支持 tagIds
- `src/app/api/tasks/[id]/route.ts` — DELETE 改软删；PATCH 支持 tagIds
- `src/components/tasks/types.ts` — Task 接口扩展（tags/trashed/trashedAt/expiresAt）
- `src/components/tasks/use-tasks.ts` — trashed 过滤、restoreTask、purgeTask、tagIds
- `src/components/tasks/TaskPanel.tsx` — view prop，TrashView 分流
- `src/components/tasks/TaskItem.tsx` — 彩色标签展示 + TagPicker Popover
- `src/components/tasks/QuickAddDialog.tsx` — 标签行 + TagPicker
- `src/app/tasks/page.tsx` — flex 布局 + TaskSidebar + 选中态
- `src/lib/tasks/smart-views.ts` — filterBySmartView 过滤 trashed
- `tests/unit/task-smart-views.test.ts` — 新增 trashed 用例

---

### Task 1: Prisma schema + migration（Tag / TaskTag / Task 软删除）

**Files:**
- Modify: `prisma/schema.prisma`（Task 模型在 607-634 行；文件末尾追加 Tag/TaskTag）
- Create: `prisma/migrations/<timestamp>_task_phase_b_tags_trash/migration.sql`（由 migrate 生成后手动追加数据迁移）

**Interfaces:**
- Consumes: 无
- Produces: `Tag` 模型（字段：id/name/color/sortOrder/createdAt/updatedAt/tasks）、`TaskTag` 模型（taskId/tagId 复合主键）、Task 新字段 `trashed`/`trashedAt`/`expiresAt` + 反向关联 `tags TaskTag[]`。后续所有任务依赖这些模型。

- [ ] **Step 1: 编辑 schema.prisma，在 Task 模型新增软删字段与反向关联**

在 `prisma/schema.prisma` 的 Task 模型（约 622 行 `updatedAt` 之后、`parent` 关系之前）插入三个字段：

```prisma
  trashed   Boolean   @default(false)
  trashedAt DateTime?
  expiresAt DateTime?
```

在 Task 模型的关系区（`space Space? @relation(...)` 之后）新增反向关联：

```prisma
  tags TaskTag[]
```

在 Task 模型的索引区（约 633 行）新增：

```prisma
  @@index([trashed])
```

- [ ] **Step 2: 在 schema.prisma 文件末尾追加 Tag 与 TaskTag 模型**

```prisma
model Tag {
  id        String    @id @default(cuid())
  name      String    @unique
  color     String    @default("#6b7280")
  sortOrder Int       @default(0)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  tasks     TaskTag[]
}

model TaskTag {
  taskId String
  tagId  String
  task   Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  tag    Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([taskId, tagId])
  @@index([tagId])
}
```

- [ ] **Step 3: 生成迁移 SQL（仅生成不应用）**

```bash
DATABASE_URL="file:./dev.db" pnpm prisma migrate dev --create-only --name task_phase_b_tags_trash
```

预期：在 `prisma/migrations/<timestamp>_task_phase_b_tags_trash/migration.sql` 生成 CREATE TABLE / ALTER TABLE 语句，控制台提示迁移已创建但未应用。

- [ ] **Step 4: 手动追加数据迁移 SQL**

在上一步生成的 `migration.sql` 末尾追加（把现有 `Task.tagsJson` 字符串数组灌进 Tag + TaskTag）：

```sql
-- 数据迁移：把现有 Task.tagsJson 字符串灌进 Tag + TaskTag
INSERT OR IGNORE INTO "Tag" ("id", "name", "color", "sortOrder", "createdAt", "updatedAt")
SELECT DISTINCT
  'tag_' || lower(hex(randomblob(8))),
  "name",
  '#6b7280',
  0,
  datetime('now'),
  datetime('now')
FROM (
  SELECT DISTINCT je.value AS "name"
  FROM "Task" t, json_each(t."tagsJson") je
  WHERE json_valid(t."tagsJson") AND t."tagsJson" != '[]'
);

INSERT OR IGNORE INTO "TaskTag" ("taskId", "tagId")
SELECT t."id", (SELECT "id" FROM "Tag" WHERE "name" = je.value)
FROM "Task" t, json_each(t."tagsJson") je
WHERE json_valid(t."tagsJson") AND t."tagsJson" != '[]';
```

- [ ] **Step 5: 应用迁移 + 重新生成 Prisma client**

```bash
DATABASE_URL="file:./dev.db" pnpm prisma migrate dev
```

预期：应用刚才的迁移（含数据迁移），输出 `Applied migration`。然后：

```bash
DATABASE_URL="file:./dev.db" pnpm prisma generate
```

- [ ] **Step 6: 验证迁移成功**

```bash
sqlite3 dev.db "SELECT COUNT(*) FROM Tag; SELECT COUNT(*) FROM TaskTag;"
```

预期：返回两个数字（来自历史 tagsJson 的标签数量）。如果历史无标签则返回 0、0，亦正常。

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma "prisma/migrations/<timestamp>_task_phase_b_tags_trash/migration.sql"
git commit -m "feat(tasks): Tag/TaskTag 模型 + Task 软删除字段 + 数据迁移"
```

---

### Task 2: trash-lifecycle.ts 纯函数（TDD）

**Files:**
- Create: `src/lib/tasks/trash-lifecycle.ts`
- Test: `tests/unit/task-trash-lifecycle.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `TRASH_RETENTION_DAYS = 30`；`computeExpiresAt(trashedAt: Date, retentionDays?): Date`；`isExpired(expiresAt: Date | null, now?): boolean`；`daysLeft(expiresAt: Date | null, now?): number | null`。Task 6 与 Task 15 依赖这些函数。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/task-trash-lifecycle.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import {
  TRASH_RETENTION_DAYS,
  computeExpiresAt,
  isExpired,
  daysLeft,
} from "@/lib/tasks/trash-lifecycle";

describe("trash-lifecycle", () => {
  const trashedAt = new Date("2026-07-10T00:00:00.000Z");

  it("computeExpiresAt 返回 trashedAt + 30 天", () => {
    const exp = computeExpiresAt(trashedAt);
    expect(exp).toEqual(new Date("2026-08-09T00:00:00.000Z"));
  });

  it("computeExpiresAt 支持自定义 retentionDays", () => {
    const exp = computeExpiresAt(trashedAt, 7);
    expect(exp).toEqual(new Date("2026-07-17T00:00:00.000Z"));
  });

  it("TRASH_RETENTION_DAYS 为 30", () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
  });

  it("isExpired：过期返回 true", () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    expect(isExpired(new Date("2026-08-09T00:00:00.000Z"), now)).toBe(true);
  });

  it("isExpired：未过期返回 false", () => {
    const now = new Date("2026-08-08T00:00:00.000Z");
    expect(isExpired(new Date("2026-08-09T00:00:00.000Z"), now)).toBe(false);
  });

  it("isExpired：恰好到期（相等）返回 false（用 < 判断）", () => {
    const now = new Date("2026-08-09T00:00:00.000Z");
    expect(isExpired(new Date("2026-08-09T00:00:00.000Z"), now)).toBe(false);
  });

  it("isExpired：null 永不过期", () => {
    expect(isExpired(null, new Date())).toBe(false);
  });

  it("daysLeft：剩余 18 天", () => {
    const now = new Date("2026-07-22T00:00:00.000Z");
    const exp = new Date("2026-08-09T00:00:00.000Z");
    expect(daysLeft(exp, now)).toBe(18);
  });

  it("daysLeft：向上取整（剩余 17.5 天 → 18）", () => {
    const now = new Date("2026-07-22T12:00:00.000Z");
    const exp = new Date("2026-08-09T00:00:00.000Z");
    expect(daysLeft(exp, now)).toBe(18);
  });

  it("daysLeft：已过期返回 0", () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    const exp = new Date("2026-08-09T00:00:00.000Z");
    expect(daysLeft(exp, now)).toBe(0);
  });

  it("daysLeft：null 返回 null", () => {
    expect(daysLeft(null, new Date())).toBe(null);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test tests/unit/task-trash-lifecycle.test.ts
```

预期：FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `src/lib/tasks/trash-lifecycle.ts`：

```ts
export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function computeExpiresAt(
  trashedAt: Date,
  retentionDays: number = TRASH_RETENTION_DAYS
): Date {
  return new Date(trashedAt.getTime() + retentionDays * DAY_MS);
}

export function isExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() < now.getTime();
}

export function daysLeft(expiresAt: Date | null, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  const ms = expiresAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test tests/unit/task-trash-lifecycle.test.ts
```

预期：PASS（11/11）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/trash-lifecycle.ts tests/unit/task-trash-lifecycle.test.ts
git commit -m "feat(tasks): 软删除生命周期纯函数 + 单测"
```

---

### Task 3: tag-colors.ts 纯函数（TDD）

**Files:**
- Create: `src/lib/tasks/tag-colors.ts`
- Test: `tests/unit/task-tag-colors.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `PRESET_TAG_COLORS`（8 色 readonly 数组，首项 `"#6b7280"`）；`normalizeColor(hex: string): string`（合法 `#rrggbb` 透传，否则回退 `PRESET_TAG_COLORS[0]`）。Task 13（TagManageDialog）依赖 PRESET_TAG_COLORS。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/task-tag-colors.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { PRESET_TAG_COLORS, normalizeColor } from "@/lib/tasks/tag-colors";

describe("tag-colors", () => {
  it("PRESET_TAG_COLORS 首项为默认灰 #6b7280", () => {
    expect(PRESET_TAG_COLORS[0]).toBe("#6b7280");
  });

  it("PRESET_TAG_COLORS 至少 8 色", () => {
    expect(PRESET_TAG_COLORS.length).toBeGreaterThanOrEqual(8);
  });

  it("normalizeColor：合法 hex 透传", () => {
    expect(normalizeColor("#3b82f6")).toBe("#3b82f6");
  });

  it("normalizeColor：大写 hex 透传", () => {
    expect(normalizeColor("#ABCDEF")).toBe("#ABCDEF");
  });

  it("normalizeColor：非法值回退默认灰", () => {
    expect(normalizeColor("not-a-color")).toBe("#6b7280");
  });

  it("normalizeColor：3 位短 hex 回退默认灰（仅接受 6 位）", () => {
    expect(normalizeColor("#fff")).toBe("#6b7280");
  });

  it("normalizeColor：空字符串回退默认灰", () => {
    expect(normalizeColor("")).toBe("#6b7280");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test tests/unit/task-tag-colors.test.ts
```

预期：FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `src/lib/tasks/tag-colors.ts`：

```ts
export const PRESET_TAG_COLORS = [
  "#6b7280", // 灰（默认）
  "#3b82f6", // 蓝
  "#22c55e", // 绿
  "#f59e0b", // 黄
  "#ef4444", // 红
  "#8b5cf6", // 紫
  "#ec4899", // 粉
  "#14b8a6", // 青
] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeColor(hex: string): string {
  return HEX_RE.test(hex) ? hex : PRESET_TAG_COLORS[0];
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test tests/unit/task-tag-colors.test.ts
```

预期：PASS（7/7）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/tag-colors.ts tests/unit/task-tag-colors.test.ts
git commit -m "feat(tasks): 标签颜色常量与归一化纯函数 + 单测"
```

---

### Task 4: smart-views.ts 过滤 trashed（TDD）

**Files:**
- Modify: `src/lib/tasks/smart-views.ts:49-58`（`filterBySmartView`）
- Test: `tests/unit/task-smart-views.test.ts`（新增用例）

**Interfaces:**
- Consumes: `Task` 接口（含 `trashed` 字段，由 Task 9 定义；此任务测试用内联对象，仅需 `trashed` 属性存在）
- Produces: `filterBySmartView` 现在先过滤 `trashed === false`，再走原谓词。

- [ ] **Step 1: 在现有测试文件新增失败用例**

在 `tests/unit/task-smart-views.test.ts` 末尾追加（不改动已有用例）：

```ts
describe("filterBySmartView trashed 过滤", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");
  const todayTask = {
    id: "t1",
    status: "todo",
    dueDate: "2026-07-10T12:00:00.000Z",
    completedAt: null,
    spaceId: null,
    trashed: true,
  } as any;

  it("trashed 任务即使 dueDate 在今天也不进入 today 视图", () => {
    expect(filterBySmartView([todayTask], "today", now)).toEqual([]);
  });

  it("trashed 任务不进入 next7days 视图", () => {
    expect(filterBySmartView([todayTask], "next7days", now)).toEqual([]);
  });

  it("trashed 任务不进入 inbox 视图", () => {
    expect(filterBySmartView([todayTask], "inbox", now)).toEqual([]);
  });
});
```

确保文件顶部已 import `filterBySmartView`（已有）。

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test tests/unit/task-smart-views.test.ts
```

预期：新用例 FAIL（trashed 任务被算进 today）。

- [ ] **Step 3: 修改 filterBySmartView 过滤 trashed**

修改 `src/lib/tasks/smart-views.ts:49-58`，在 switch 前加一行过滤：

```ts
/** 按智能视图批量过滤。now 默认 new Date()。trashed 任务一律排除。 */
export function filterBySmartView(tasks: Task[], view: SmartView, now: Date = new Date()): Task[] {
  const active = tasks.filter((t) => !t.trashed);
  switch (view) {
    case "today":
      return active.filter((t) => isToday(t, now));
    case "next7days":
      return active.filter((t) => isNext7Days(t, now));
    case "inbox":
      return active.filter((t) => isInbox(t));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test tests/unit/task-smart-views.test.ts
```

预期：PASS（含原有用例 + 3 个新用例）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/smart-views.ts tests/unit/task-smart-views.test.ts
git commit -m "fix(tasks): 智能视图过滤掉已废弃任务"
```

---

### Task 5: Tag CRUD API

**Files:**
- Create: `src/app/api/tags/route.ts`（GET / POST）
- Create: `src/app/api/tags/[id]/route.ts`（PATCH / DELETE）

**Interfaces:**
- Consumes: Prisma `Tag` 模型（Task 1）
- Produces: `GET /api/tags` → `{ tags: [{ id, name, color, sortOrder, _count: { tasks } }] }`；`POST /api/tags` body `{ name, color? }` → `201 { tag }`，name 冲突 `409`；`PATCH /api/tags/:id` body `{ name?, color?, sortOrder? }` → `{ tag }`；`DELETE /api/tags/:id` → `{ success: true }`（cascade 清 TaskTag）。Task 11/13 依赖此 API。

- [ ] **Step 1: 创建 tags/route.ts（GET + POST）**

创建 `src/app/api/tags/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normalizeColor } from "@/lib/tasks/tag-colors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tags — 列出全部标签（含未废弃任务数）
export async function GET() {
  const tags = await prisma.tag.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { tasks: { where: { task: { trashed: false } } } } },
    },
  });
  return NextResponse.json({ tags });
}

const createSchema = z.object({
  name: z.string().trim().min(1, "标签名不能为空").max(50),
  color: z.string().optional(),
});

// POST /api/tags — 创建标签
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { name, color } = parsed.data;
    const tag = await prisma.tag.create({
      data: { name, color: normalizeColor(color ?? "#6b7280") },
    });
    return NextResponse.json({ tag }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "标签名已存在" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "创建标签失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: 创建 tags/[id]/route.ts（PATCH + DELETE）**

创建 `src/app/api/tags/[id]/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normalizeColor } from "@/lib/tasks/tag-colors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/tags/[id]
export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.color !== undefined) data.color = normalizeColor(parsed.data.color);
    if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;

    const tag = await prisma.tag.update({ where: { id }, data });
    return NextResponse.json({ tag });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "标签名已存在" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "更新标签失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/tags/[id] — cascade 清 TaskTag，任务保留
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await prisma.tag.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "删除标签失败" }, { status: 500 });
  }
}
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 4: Commit**

```bash
git add src/app/api/tags/route.ts "src/app/api/tags/[id]/route.ts"
git commit -m "feat(tags): Tag CRUD API（GET/POST/PATCH/DELETE）"
```

---

### Task 6: Task 软删除 + restore + purge 端点

**Files:**
- Modify: `src/app/api/tasks/[id]/route.ts:84-93`（DELETE 改软删）
- Create: `src/app/api/tasks/[id]/restore/route.ts`（POST）
- Create: `src/app/api/tasks/[id]/purge/route.ts`（DELETE）

**Interfaces:**
- Consumes: `computeExpiresAt` from `@/lib/tasks/trash-lifecycle`（Task 2）；Prisma `Task` 模型含软删字段（Task 1）
- Produces: `DELETE /api/tasks/:id` 改为软删（级联后代）；`POST /api/tasks/:id/restore` 恢复（级联后代）；`DELETE /api/tasks/:id/purge` 彻底删除（cascade）。Task 10/15 依赖 restore/purge。

- [ ] **Step 1: 改写 DELETE 为软删除（含后代级联）**

替换 `src/app/api/tasks/[id]/route.ts:84-93` 的整个 DELETE 函数：

```ts
// DELETE /api/tasks/[id] — 软删除（移入垃圾箱，级联后代，30 天后过期）
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const now = new Date();
    const expiresAt = computeExpiresAt(now);
    await trashSubtree(id, now, expiresAt);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "删除任务失败" }, { status: 500 });
  }
}

/** 递归标记任务及其所有后代为 trashed。 */
async function trashSubtree(rootId: string, now: Date, expiresAt: Date): Promise<void> {
  await prisma.task.update({
    where: { id: rootId },
    data: { trashed: true, trashedAt: now, expiresAt },
  });
  const children = await prisma.task.findMany({
    where: { parentId: rootId },
    select: { id: true },
  });
  for (const child of children) {
    await trashSubtree(child.id, now, expiresAt);
  }
}
```

在文件顶部 import 区追加：

```ts
import { computeExpiresAt } from "@/lib/tasks/trash-lifecycle";
```

- [ ] **Step 2: 创建 restore 端点**

创建 `src/app/api/tasks/[id]/restore/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/tasks/[id]/restore — 恢复任务及其被废弃的后代
export async function POST(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await restoreSubtree(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "恢复任务失败" }, { status: 500 });
  }
}

/** 递归清除任务及其被废弃后代的 trashed 标记。 */
async function restoreSubtree(rootId: string): Promise<void> {
  await prisma.task.updateMany({
    where: { id: rootId, trashed: true },
    data: { trashed: false, trashedAt: null, expiresAt: null },
  });
  const children = await prisma.task.findMany({
    where: { parentId: rootId, trashed: true },
    select: { id: true },
  });
  for (const child of children) {
    await restoreSubtree(child.id);
  }
}
```

- [ ] **Step 3: 创建 purge 端点**

创建 `src/app/api/tasks/[id]/purge/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// DELETE /api/tasks/[id]/purge — 彻底删除（cascade children）
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await prisma.task.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "彻底删除失败" }, { status: 500 });
  }
}
```

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/tasks/[id]/route.ts" "src/app/api/tasks/[id]/restore/route.ts" "src/app/api/tasks/[id]/purge/route.ts"
git commit -m "feat(tasks): DELETE 改软删除 + restore/purge 端点"
```

---

### Task 7: Task GET 扁平化 tags / 默认排除 trashed / trashed root / 懒清理 + POST/PATCH tagIds

**Files:**
- Modify: `src/app/api/tasks/route.ts`（GET + POST）
- Modify: `src/app/api/tasks/[id]/route.ts`（PATCH 支持 tagIds）

**Interfaces:**
- Consumes: Prisma `Tag`/`TaskTag`（Task 1）
- Produces: GET 返回的任务对象带扁平 `tags: [{ id, name, color }]`；GET 默认 `trashed:false`，`?trashed=true` 返回 trashed root；GET 每次先懒清理过期任务。POST/PATCH 支持 `tagIds?: string[]` 全量覆盖标签。Task 10 依赖 GET 的扁平 tags 与 POST/PATCH 的 tagIds。

- [ ] **Step 1: 改写 GET（懒清理 + trashed 过滤 + include tags + 扁平化）**

替换 `src/app/api/tasks/route.ts:20-64` 整个 GET 函数：

```ts
// GET /api/tasks - 列出任务（支持筛选）
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");
  const spaceId = searchParams.get("spaceId");
  const parentId = searchParams.get("parentId");
  const priority = searchParams.get("priority");
  const smartViewRaw = searchParams.get("smartView");
  const smartView: SmartView | null =
    smartViewRaw === "today" || smartViewRaw === "next7days" || smartViewRaw === "inbox"
      ? smartViewRaw
      : null;
  const trashedFlag = searchParams.get("trashed") === "true";

  // 懒清理：删除已过期的废弃任务
  await prisma.task.deleteMany({
    where: { trashed: true, expiresAt: { lt: new Date() } },
  });

  const where: Record<string, unknown> = {};
  if (trashedFlag) {
    // 垃圾箱视图：只返回 trashed root
    where.trashed = true;
    where.OR = [{ parentId: null }, { parent: { trashed: false } }];
  } else {
    where.trashed = false;
    if (status) where.status = status;
    if (spaceId) where.spaceId = spaceId;
    else if (smartView === "inbox") where.spaceId = null;
    if (parentId !== null && parentId !== undefined) {
      where.parentId = parentId === "null" ? null : parentId;
    } else {
      where.parentId = null;
    }
    if (priority) where.priority = parseInt(priority, 10);
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: trashedFlag
      ? [{ trashedAt: "desc" }]
      : [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: {
      children: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        where: { trashed: false },
        include: {
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
          children: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
            where: { trashed: false },
          },
        },
      },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      space: { select: { id: true, name: true } },
    },
  });

  // 扁平化 tags: [{ tag: {...} }] → [{ ...tagInfo }]
  const flat = tasks.map((t) => ({
    ...t,
    tags: t.tags.map((tt) => tt.tag),
    children: t.children?.map((c) => ({ ...c, tags: c.tags?.map((tt) => tt.tag) ?? [] })),
  }));

  const result = smartView
    ? filterBySmartView(flat as unknown as Task[], smartView) as unknown as typeof flat
    : flat;

  return NextResponse.json({ tasks: result });
}
```

- [ ] **Step 2: POST 支持 tagIds**

修改 `src/app/api/tasks/route.ts` 的 `createSchema`（约 7-17 行），在 `tagsJson` 后加一行：

```ts
  tagIds: z.array(z.string()).optional(),
```

修改 POST handler（约 75-97 行），把解构改为：

```ts
    const { title, content, status, priority, dueDate, parentId, spaceId, sortOrder, tagsJson, tagIds } =
      parsed.data;
```

把 `prisma.task.create` 的 `data` 块改为（在 `tagsJson: tagsJson ?? "[]"` 之后加 tags 连接）：

```ts
    const task = await prisma.task.create({
      data: {
        title,
        content: content ?? "",
        status: status ?? "todo",
        priority: priority ?? 0,
        dueDate: dueDate ? new Date(dueDate) : null,
        parentId: parentId ?? null,
        spaceId: spaceId ?? null,
        sortOrder: sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
        tagsJson: tagsJson ?? "[]",
        tags: tagIds?.length
          ? { create: tagIds.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: { children: true, tags: { include: { tag: { select: { id: true, name: true, color: true } } } } },
    });
```

- [ ] **Step 3: PATCH 支持 tagIds**

修改 `src/app/api/tasks/[id]/route.ts` 的 `updateSchema`（约 5-16 行），在 `isCollapsed` 后加：

```ts
  tagIds: z.array(z.string()).optional(),
```

修改 PATCH handler 解构（约 49 行），追加 `tagIds`：

```ts
    const { title, content, status, priority, dueDate, parentId, spaceId, sortOrder, tagsJson, isCollapsed, tagIds } =
      parsed.data;
```

替换 `prisma.task.update` 调用（约 71-75 行）为事务化、支持 tagIds 全量替换：

```ts
    const task = await prisma.$transaction(async (tx) => {
      if (tagIds !== undefined) {
        await tx.taskTag.deleteMany({ where: { taskId: id } });
        if (tagIds.length > 0) {
          await tx.taskTag.createMany({
            data: tagIds.map((tagId) => ({ taskId: id, tagId })),
          });
        }
      }
      return tx.task.update({
        where: { id },
        data,
        include: {
          children: true,
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        },
      });
    });
```

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tasks/route.ts "src/app/api/tasks/[id]/route.ts"
git commit -m "feat(tasks): GET 扁平化 tags/排除 trashed/懒清理 + POST·PATCH 支持 tagIds"
```

---

### Task 8: Task counts API（侧边栏计数）

**Files:**
- Create: `src/app/api/tasks/counts/route.ts`

**Interfaces:**
- Consumes: Prisma `Task`（Task 1）
- Produces: `GET /api/tasks/counts` → `{ total: number, inbox: number, bySpace: Record<string, number>, trashed: number }`。`total`/`inbox`/`bySpace` 只计 `trashed:false`；`trashed` 计 trashed root 数量。Task 17（TaskSidebar）依赖此端点。

- [ ] **Step 1: 创建 counts 端点**

创建 `src/app/api/tasks/counts/route.ts`：

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tasks/counts — 侧边栏聚合计数
export async function GET() {
  // 主视图（未废弃）按 spaceId 聚合
  const active = await prisma.task.groupBy({
    by: ["spaceId"],
    where: { trashed: false },
    _count: true,
  });

  const bySpace: Record<string, number> = {};
  let total = 0;
  let inbox = 0;
  for (const row of active) {
    const count = row._count;
    total += count;
    if (row.spaceId === null) {
      inbox += count;
    } else {
      bySpace[row.spaceId] = count;
    }
  }

  // 垃圾箱：只计 trashed root
  const trashed = await prisma.task.count({
    where: {
      trashed: true,
      OR: [{ parentId: null }, { parent: { trashed: false } }],
    },
  });

  return NextResponse.json({ total, inbox, bySpace, trashed });
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 3: Commit**

```bash
git add src/app/api/tasks/counts/route.ts
git commit -m "feat(tasks): 侧边栏聚合计数 API（total/inbox/bySpace/trashed）"
```

---

### Task 9: 前端 types.ts 扩展

**Files:**
- Modify: `src/components/tasks/types.ts`

**Interfaces:**
- Consumes: 无
- Produces: `TaskTagInfo` 接口；`Task` 接口新增 `tags: TaskTagInfo[]`、`trashed: boolean`、`trashedAt: string | null`、`expiresAt: string | null`、`space?: { id: string; name: string } | null`。后续所有前端任务依赖此类型。

- [ ] **Step 1: 编辑 types.ts**

在 `src/components/tasks/types.ts` 的 `Task` 接口（4-22 行）做两处改动。

在文件顶部（`TaskStatus` 类型定义之前）新增：

```ts
export interface TaskTagInfo {
  id: string;
  name: string;
  color: string;
}
```

替换整个 `Task` 接口（4-22 行）为：

```ts
export interface Task {
  id: string;
  title: string;
  content: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  dueTime: string | null; // "HH:mm" 格式；isAllDay=true 时忽略
  isAllDay: boolean;
  completedAt: string | null;
  parentId: string | null;
  spaceId: string | null;
  space?: { id: string; name: string } | null;
  sortOrder: number;
  tagsJson: string; // 保留只读兼容
  tags: TaskTagInfo[]; // 新增：结构化标签
  isCollapsed: boolean;
  trashed: boolean; // 新增
  trashedAt: string | null; // 新增
  expiresAt: string | null; // 新增
  createdAt: string;
  updatedAt: string;
  children?: Task[];
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

预期：可能有若干 `task.tagsJson` 相关的类型错误暴露（后续任务修复），但 `types.ts` 自身无误。若 `tsc` 报错仅来自其他文件对 `task.tags` 的缺失引用，记录即可继续。

- [ ] **Step 3: Commit**

```bash
git add src/components/tasks/types.ts
git commit -m "feat(tasks): Task 类型扩展 tags/trashed/trashedAt/expiresAt/space"
```

---

### Task 10: use-tasks.ts hook 扩展

**Files:**
- Modify: `src/components/tasks/use-tasks.ts`

**Interfaces:**
- Consumes: `Task` 类型（Task 9）
- Produces: `initialFilters.trashed?: boolean`；`restoreTask(id)`；`purgeTask(id)`；`createTask`/`updateTask` 支持 `tagIds?: string[]`。Task 12/13/15/16 依赖此 hook。

- [ ] **Step 1: 替换整个 use-tasks.ts**

替换 `src/components/tasks/use-tasks.ts` 全文：

```ts
"use client";

import { useState, useCallback, useEffect } from "react";
import type { Task, TaskStatus, TaskPriority } from "./types";

export function useTasks(initialFilters?: {
  status?: string;
  spaceId?: string;
  smartView?: "today" | "next7days" | "inbox";
  trashed?: boolean;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams();
    if (initialFilters?.status) params.set("status", initialFilters.status);
    if (initialFilters?.spaceId) params.set("spaceId", initialFilters.spaceId);
    if (initialFilters?.smartView) params.set("smartView", initialFilters.smartView);
    if (initialFilters?.trashed) params.set("trashed", "true");
    if (!initialFilters?.trashed) params.set("parentId", "null"); // 顶层任务（主视图）

    const res = await fetch(`/api/tasks?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks);
    }
    setLoading(false);
  }, [initialFilters?.status, initialFilters?.spaceId, initialFilters?.smartView, initialFilters?.trashed]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const createTask = useCallback(
    async (data: {
      title: string;
      priority?: TaskPriority;
      dueDate?: string | null;
      parentId?: string | null;
      spaceId?: string | null;
      tagIds?: string[];
    }) => {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchTasks();
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const updateTask = useCallback(
    async (
      id: string,
      data: Partial<
        Pick<Task, "title" | "content" | "status" | "priority" | "dueDate" | "sortOrder" | "tagsJson" | "isCollapsed" | "parentId"> & { tagIds?: string[] }
      >
    ) => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchTasks();
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const deleteTask = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchTasks();
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const restoreTask = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tasks/${id}/restore`, { method: "POST" });
      if (res.ok) {
        await fetchTasks();
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const purgeTask = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tasks/${id}/purge`, { method: "DELETE" });
      if (res.ok) {
        await fetchTasks();
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const reorderTasks = useCallback(
    async (items: { id: string; sortOrder: number; parentId?: string | null; status?: string }[]) => {
      const res = await fetch("/api/tasks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        await fetchTasks();
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const toggleStatus = useCallback(
    async (id: string, currentStatus: TaskStatus) => {
      const newStatus: TaskStatus = currentStatus === "done" ? "todo" : "done";
      return updateTask(id, { status: newStatus });
    },
    [updateTask]
  );

  return {
    tasks,
    loading,
    createTask,
    updateTask,
    deleteTask,
    restoreTask,
    purgeTask,
    reorderTasks,
    toggleStatus,
    refetch: fetchTasks,
  };
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

预期：无错误（或仅来自尚未改造的组件对旧字段引用，记录后继续）。

- [ ] **Step 3: Commit**

```bash
git add src/components/tasks/use-tasks.ts
git commit -m "feat(tasks): useTasks hook 支持 trashed/restoreTask/purgeTask/tagIds"
```

---

### Task 11: TagPicker 共享组件

**Files:**
- Create: `src/components/tasks/TagPicker.tsx`

**Interfaces:**
- Consumes: `GET /api/tags`（Task 5）
- Produces: `TagPicker` 组件，props `{ selectedIds: string[]; onChange: (ids: string[]) => void }`。受控多选 Popover。Task 12/13 依赖。

- [ ] **Step 1: 创建 TagPicker.tsx**

创建 `src/components/tasks/TagPicker.tsx`：

```tsx
"use client";

import { useState, useEffect } from "react";
import { Tag as TagIcon, Check } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TaskTagInfo } from "./types";

interface TagPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function TagPicker({ selectedIds, onChange }: TagPickerProps) {
  const [tags, setTags] = useState<TaskTagInfo[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) {
      fetch("/api/tags")
        .then((r) => r.json())
        .then((data) => setTags(data.tags ?? []))
        .catch(() => setTags([]));
    }
  }, [open]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((t) => t !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="p-1 text-muted-foreground hover:text-foreground rounded" title="标签">
          <TagIcon className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-3 text-center">
            请先在标签管理中创建标签
          </p>
        ) : (
          tags.map((tag) => {
            const checked = selectedIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => toggle(tag.id)}
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-1.5 rounded-sm text-sm hover:bg-accent text-left"
                )}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="flex-1 truncate">{tag.name}</span>
                {checked && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/tasks/TagPicker.tsx
git commit -m "feat(tasks): TagPicker 共享多选标签 Popover"
```

---

### Task 12: TaskItem 彩色标签展示 + TagPicker Popover

**Files:**
- Modify: `src/components/tasks/TaskItem.tsx`

**Interfaces:**
- Consumes: `Task.tags`（Task 9）、`TagPicker`（Task 11）、`onUpdate`（支持 `tagIds`，Task 10）
- Produces: TaskItem 展示彩色标签（替换灰色 pill），actions 区新增 Tag 按钮。

- [ ] **Step 1: 添加 import**

在 `src/components/tasks/TaskItem.tsx` import 区（约 3-14 行）追加：

```ts
import { TagPicker } from "./TagPicker";
```

- [ ] **Step 2: 替换灰色标签展示为彩色标签**

替换 `src/components/tasks/TaskItem.tsx:184-196`（Tags 区块）为：

```tsx
        {/* Tags */}
        {task.tags?.length > 0 && (
          <div className="flex gap-1">
            {task.tags.slice(0, 2).map((t) => (
              <span
                key={t.id}
                className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded shrink-0"
                style={{ backgroundColor: t.color + "22", color: t.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                {t.name}
              </span>
            ))}
            {task.tags.length > 2 && (
              <span className="text-xs text-muted-foreground shrink-0">
                +{task.tags.length - 2}
              </span>
            )}
          </div>
        )}
```

- [ ] **Step 3: actions 区新增 TagPicker 按钮**

替换 `src/components/tasks/TaskItem.tsx:218-239`（Actions 区块）为：

```tsx
        {/* Actions */}
        <div
          className={cn(
            "flex items-center gap-1 transition-opacity",
            showActions ? "opacity-100" : "opacity-0"
          )}
        >
          <TagPicker
            selectedIds={task.tags?.map((t) => t.id) ?? []}
            onChange={(ids) => onUpdate(task.id, { tagIds: ids })}
          />
          <button
            onClick={() => onAddSubtask(task.id)}
            className="p-1 text-muted-foreground hover:text-foreground rounded"
            title="添加子任务"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(task.id)}
            className="p-1 text-muted-foreground hover:text-red-500 rounded"
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
```

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/TaskItem.tsx
git commit -m "feat(tasks): TaskItem 彩色标签展示 + TagPicker 赋值"
```

---

### Task 13: QuickAddDialog 标签行

**Files:**
- Modify: `src/components/tasks/QuickAddDialog.tsx`

**Interfaces:**
- Consumes: `TagPicker`（Task 11）
- Produces: QuickAddDialog 新增标签行，`onAdd` 回调扩展 `tagIds`。

- [ ] **Step 1: 扩展 props 与 state**

修改 `src/components/tasks/QuickAddDialog.tsx`：

在 import 区（约 6 行）追加：

```ts
import { TagPicker } from "./TagPicker";
```

把 `QuickAddDialogProps` 的 `onAdd` 类型（约 12 行）改为：

```ts
  onAdd: (data: {
    title: string;
    priority: TaskPriority;
    dueDate: string | null;
    tagIds: string[];
  }) => Promise<boolean>;
```

在组件内 state 区（约 18 行 `dueDate` 之后）新增：

```ts
  const [tagIds, setTagIds] = useState<string[]>([]);
```

在 `useEffect` 的 reset 分支（约 26-28 行）追加：

```ts
    setTagIds([]);
```

在 `handleSubmit` 的 `onAdd` 调用（约 52-56 行）改为：

```ts
    const success = await onAdd({
      title: title.trim(),
      priority,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      tagIds,
    });
```

在成功分支（约 59-62 行）追加 `setTagIds([])`。

- [ ] **Step 2: 工具栏新增标签选择**

在 toolbar 区（约 128-136 行 date picker 之后、`<div className="flex-1" />` 之前）插入：

```tsx
            <div className="flex items-center gap-1 ml-2">
              <TagPicker selectedIds={tagIds} onChange={setTagIds} />
              {tagIds.length > 0 && (
                <span className="text-xs text-muted-foreground">{tagIds.length} 个标签</span>
              )}
            </div>
```

- [ ] **Step 3: 同步 tasks/page.tsx 的 handleQuickAdd 签名**

`src/app/tasks/page.tsx` 的 `handleQuickAdd`（约 31-42 行）需接收 `tagIds`。把签名与 body 改为：

```ts
  const handleQuickAdd = async (data: {
    title: string;
    priority: TaskPriority;
    dueDate: string | null;
    tagIds: string[];
  }) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setRefreshKey((k) => k + 1);
      return true;
    }
    return false;
  };
```

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/QuickAddDialog.tsx src/app/tasks/page.tsx
git commit -m "feat(tasks): QuickAddDialog 支持选择标签"
```

---

### Task 14: TagManageDialog 标签管理弹窗

**Files:**
- Create: `src/components/tasks/TagManageDialog.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/tags`（Task 5）、`PRESET_TAG_COLORS` + `normalizeColor`（Task 3）、`useConfirm`（`@/components/ui/confirm-dialog`）
- Produces: `TagManageDialog` 组件，props `{ open: boolean; onOpenChange: (v: boolean) => void }`。Task 17 依赖。

- [ ] **Step 1: 创建 TagManageDialog.tsx**

创建 `src/components/tasks/TagManageDialog.tsx`：

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Trash2, Plus, X, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { PRESET_TAG_COLORS, normalizeColor } from "@/lib/tasks/tag-colors";

interface TagRow {
  id: string;
  name: string;
  color: string;
  _count?: { tasks: number };
}

interface TagManageDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function TagManageDialog({ open, onOpenChange }: TagManageDialogProps) {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(PRESET_TAG_COLORS[0]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(PRESET_TAG_COLORS[0]);
  const [error, setError] = useState("");
  const { confirm: confirmDialog, dialog: confirmElement } = useConfirm();

  const load = useCallback(async () => {
    const res = await fetch("/api/tags");
    if (res.ok) {
      const data = await res.json();
      setTags(data.tags ?? []);
    }
  }, []);

  useEffect(() => {
    if (open) {
      load();
      setError("");
      setNewName("");
      setNewColor(PRESET_TAG_COLORS[0]);
    }
  }, [open, load]);

  const startEdit = (tag: TagRow) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(normalizeColor(tag.color));
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const res = await fetch(`/api/tags/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), color: editColor }),
    });
    if (res.status === 409) {
      setError("标签名已存在");
      return;
    }
    if (!res.ok) return;
    setEditingId(null);
    setError("");
    await load();
  };

  const handleDelete = async (tag: TagRow) => {
    const ok = await confirmDialog({
      title: "删除标签",
      description: `将解除 ${tag._count?.tasks ?? 0} 个任务的关联，任务本身保留。确定删除「${tag.name}」？`,
    });
    if (!ok) return;
    const res = await fetch(`/api/tags/${tag.id}`, { method: "DELETE" });
    if (res.ok) await load();
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), color: newColor }),
    });
    if (res.status === 409) {
      setError("标签名已存在");
      return;
    }
    if (!res.ok) return;
    setNewName("");
    setNewColor(PRESET_TAG_COLORS[0]);
    setError("");
    await load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>标签管理</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 max-h-72 overflow-y-auto">
          {tags.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">暂无标签</p>
          )}
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent">
              {editingId === tag.id ? (
                <>
                  <ColorSwatches value={editColor} onChange={setEditColor} />
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-7 text-sm flex-1"
                    autoFocus
                  />
                  <button onClick={saveEdit} className="p-1 hover:text-primary" title="保存">
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-1 hover:text-muted-foreground" title="取消">
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: normalizeColor(tag.color) }} />
                  <span className="flex-1 text-sm truncate">{tag.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {tag._count?.tasks ?? 0} 个任务
                  </span>
                  <button onClick={() => startEdit(tag)} className="p-1 text-muted-foreground hover:text-foreground" title="编辑">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(tag)} className="p-1 text-muted-foreground hover:text-red-500" title="删除">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* 新建标签 */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <ColorSwatches value={newColor} onChange={setNewColor} />
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新标签名"
            className="h-8 text-sm flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>
            <Plus className="h-4 w-4" />
            新建
          </Button>
        </div>
      </DialogContent>
      {confirmElement}
    </Dialog>
  );
}

function ColorSwatches({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      {PRESET_TAG_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn(
            "w-5 h-5 rounded-full border-2 transition-transform",
            value === c ? "border-foreground scale-110" : "border-transparent"
          )}
          style={{ backgroundColor: c }}
          title={c}
        />
      ))}
      <label className="relative w-5 h-5 rounded-full border border-border cursor-pointer overflow-hidden" title="自定义">
        <span className="absolute inset-0" style={{ backgroundColor: value }} />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/tasks/TagManageDialog.tsx
git commit -m "feat(tasks): 标签管理弹窗（CRUD + 颜色选择）"
```

---

### Task 15: TrashView 垃圾箱视图

**Files:**
- Create: `src/components/tasks/TrashView.tsx`

**Interfaces:**
- Consumes: `useTasks({ trashed: true })`（Task 10）、`daysLeft`（Task 2）、`useConfirm`
- Produces: `TrashView` 组件，渲染被软删的 trashed root 列表，支持恢复与彻底删除。Task 16 依赖。

- [ ] **Step 1: 创建 TrashView.tsx**

创建 `src/components/tasks/TrashView.tsx`：

```tsx
"use client";

import { RotateCcw, Trash2, Inbox } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { daysLeft } from "@/lib/tasks/trash-lifecycle";
import { useTasks } from "./use-tasks";

export function TrashView() {
  const { tasks, loading, restoreTask, purgeTask } = useTasks({ trashed: true });
  const { confirm: confirmDialog, dialog: confirmElement } = useConfirm();

  const handlePurge = async (id: string, title: string) => {
    const ok = await confirmDialog({
      title: "彻底删除",
      description: `「${title}」将被永久删除，此操作不可撤销。`,
    });
    if (!ok) return;
    await purgeTask(id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
        <Inbox className="h-8 w-8" />
        <p className="text-sm">垃圾箱是空的</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {tasks.map((task) => {
        const left = daysLeft(task.expiresAt);
        return (
          <div
            key={task.id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent/50"
          >
            <span className="flex-1 text-sm truncate opacity-70 line-through">{task.title}</span>
            {task.space && (
              <span className="text-xs text-muted-foreground shrink-0">📁 {task.space.name}</span>
            )}
            <div className="flex gap-1 shrink-0">
              {task.tags?.map((t) => (
                <span
                  key={t.id}
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: t.color }}
                  title={t.name}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {left !== null ? `还剩 ${left} 天` : ""}
            </span>
            <button
              onClick={() => restoreTask(task.id)}
              className="p-1 text-muted-foreground hover:text-primary rounded"
              title="恢复"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handlePurge(task.id, task.title)}
              className="p-1 text-muted-foreground hover:text-red-500 rounded"
              title="彻底删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
      {confirmElement}
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/tasks/TrashView.tsx
git commit -m "feat(tasks): 垃圾箱视图（恢复 + 彻底删除 + 剩余天数）"
```

---

### Task 16: TaskPanel view 分流

**Files:**
- Modify: `src/components/tasks/TaskPanel.tsx`

**Interfaces:**
- Consumes: `TrashView`（Task 15）、`useTasks({ trashed })`（Task 10）
- Produces: `TaskPanel` props 新增 `view?: "main" | "trash"`（默认 `"main"`），trash 模式渲染 `TrashView` 并隐藏 smart view 分段控件与 status 筛选器。Task 18 依赖。

- [ ] **Step 1: 扩展 props 与分流**

修改 `src/components/tasks/TaskPanel.tsx`：

import 区追加：

```ts
import { TrashView } from "./TrashView";
```

把 `TaskPanelProps`（约 13-15 行）改为：

```ts
interface TaskPanelProps {
  spaceId?: string;
  view?: "main" | "trash";
}
```

把函数签名与 hook 调用（约 17-26 行）改为。**注意**：`useTasks` 必须在 `if (view === "trash") return` **之前**调用，否则违反 React Hooks 规则（条件 return 后再调 hook）：

```ts
export function TaskPanel({ spaceId, view = "main" }: TaskPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [smartView, setSmartView] = useState<SmartView | null>(null);
  const { tasks, loading, createTask, updateTask, deleteTask, reorderTasks, toggleStatus } =
    useTasks({
      spaceId,
      status: statusFilter || undefined,
      smartView: smartView ?? undefined,
    });

  if (view === "trash") {
    return <TrashView />;
  }
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/tasks/TaskPanel.tsx
git commit -m "feat(tasks): TaskPanel 支持 view=trash 分流到 TrashView"
```

---

### Task 17: TaskSidebar 左侧导航

**Files:**
- Create: `src/components/tasks/TaskSidebar.tsx`

**Interfaces:**
- Consumes: `GET /api/tasks/counts`（Task 8）、`GET /api/spaces`（已有）、`TagManageDialog`（Task 14）
- Produces: `TaskSidebar` 组件，props `{ selected: SelectedKey; onSelect: (key) => void; refreshKey?: number }`。`SelectedKey = { type: "all" } | { type: "inbox" } | { type: "space"; id: string } | { type: "trash" }`。Task 18 依赖。

- [ ] **Step 1: 创建 TaskSidebar.tsx**

创建 `src/components/tasks/TaskSidebar.tsx`：

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { ListChecks, Inbox, FolderOpen, Trash2, Tag as TagIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TagManageDialog } from "./TagManageDialog";

export type SelectedKey =
  | { type: "all" }
  | { type: "inbox" }
  | { type: "space"; id: string }
  | { type: "trash" };

interface SpaceItem {
  id: string;
  name: string;
}

type Counts = {
  total: number;
  inbox: number;
  bySpace: Record<string, number>;
  trashed: number;
};

interface TaskSidebarProps {
  selected: SelectedKey;
  onSelect: (key: SelectedKey) => void;
  refreshKey?: number;
}

export function TaskSidebar({ selected, onSelect, refreshKey }: TaskSidebarProps) {
  const [spaces, setSpaces] = useState<SpaceItem[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, inbox: 0, bySpace: {}, trashed: 0 });
  const [tagOpen, setTagOpen] = useState(false);

  const load = useCallback(async () => {
    const [spaceRes, countRes] = await Promise.all([
      fetch("/api/spaces"),
      fetch("/api/tasks/counts"),
    ]);
    if (spaceRes.ok) {
      const data = await spaceRes.json();
      setSpaces(data.spaces ?? []);
    }
    if (countRes.ok) {
      setCounts(await countRes.json());
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const Row = ({
    icon: Icon,
    label,
    count,
    active,
    onClick,
  }: {
    icon: React.ElementType;
    label: string;
    count?: number;
    active: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={cn("text-xs shrink-0", active ? "opacity-80" : "text-muted-foreground")}>
          {count}
        </span>
      )}
    </button>
  );

  return (
    <aside className="w-60 shrink-0 border-r border-border flex flex-col gap-1 p-3 h-full">
      <Row
        icon={ListChecks}
        label="全部任务"
        count={counts.total}
        active={selected.type === "all"}
        onClick={() => onSelect({ type: "all" })}
      />
      <Row
        icon={Inbox}
        label="收集箱"
        count={counts.inbox}
        active={selected.type === "inbox"}
        onClick={() => onSelect({ type: "inbox" })}
      />

      <div className="h-px bg-border my-1" />

      <div className="flex items-center justify-between px-2">
        <span className="text-xs text-muted-foreground">空间</span>
      </div>
      {spaces.length === 0 ? (
        <p className="text-xs text-muted-foreground px-2 py-1">暂无空间</p>
      ) : (
        spaces.map((space) => (
          <Row
            key={space.id}
            icon={FolderOpen}
            label={space.name}
            count={counts.bySpace[space.id]}
            active={selected.type === "space" && selected.id === space.id}
            onClick={() => onSelect({ type: "space", id: space.id })}
          />
        ))
      )}

      <div className="h-px bg-border my-1" />

      <Row
        icon={Trash2}
        label="垃圾箱"
        count={counts.trashed}
        active={selected.type === "trash"}
        onClick={() => onSelect({ type: "trash" })}
      />

      <div className="flex-1" />

      <button
        onClick={() => setTagOpen(true)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <TagIcon className="h-4 w-4 shrink-0" />
        标签管理
      </button>

      <TagManageDialog open={tagOpen} onOpenChange={setTagOpen} />
    </aside>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 3: Commit**

```bash
git add src/components/tasks/TaskSidebar.tsx
git commit -m "feat(tasks): TaskSidebar 左侧空间/收集箱/垃圾箱/标签管理导航"
```

---

### Task 18: tasks/page.tsx 布局整合

**Files:**
- Modify: `src/app/tasks/page.tsx`

**Interfaces:**
- Consumes: `TaskSidebar`（Task 17）、`TaskPanel`（Task 16，支持 `view`/`spaceId`）
- Produces: `/tasks` 页面 flex 布局（侧边栏 + 主区），侧边栏选中态驱动 TaskPanel 的 spaceId/view。

- [ ] **Step 1: 重写 tasks/page.tsx 布局**

替换 `src/app/tasks/page.tsx` 的 return 部分（44-85 行）与新增 selected 状态。完整文件：

```tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, CheckSquare, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskPanel } from "@/components/tasks/TaskPanel";
import { QuickAddDialog } from "@/components/tasks/QuickAddDialog";
import { TaskSidebar, type SelectedKey } from "@/components/tasks/TaskSidebar";
import type { TaskPriority } from "@/components/tasks/types";

export default function TasksPage() {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<SelectedKey>({ type: "all" });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Global keyboard shortcut for quick add
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        return;

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setQuickAddOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleQuickAdd = async (data: {
    title: string;
    priority: TaskPriority;
    dueDate: string | null;
    tagIds: string[];
  }) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setRefreshKey((k) => k + 1);
      return true;
    }
    return false;
  };

  // 选中态映射：space → 传 spaceId；trash → view=trash；all/inbox → 不带 spaceId（inbox 计数仅展示，过滤复用智能视图分段控件）
  const spaceId = selected.type === "space" ? selected.id : undefined;
  const view: "main" | "trash" = selected.type === "trash" ? "trash" : "main";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent md:hidden"
              title="菜单"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Button asChild variant="ghost" size="icon" className="h-8 w-8 hidden md:inline-flex">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <CheckSquare className="h-5 w-5 text-primary" />
              <h1 className="font-semibold text-lg">任务</h1>
            </div>
          </div>

          <Button onClick={() => setQuickAddOpen(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            新建任务
            <kbd className="ml-1 text-[10px] opacity-60 hidden sm:inline">⌘⇧T</kbd>
          </Button>
        </div>
      </header>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 mx-auto max-w-6xl w-full px-6">
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <TaskSidebar selected={selected} onSelect={setSelected} refreshKey={refreshKey} />
        </div>

        {/* Mobile sidebar drawer */}
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
            <div className="relative bg-background h-full">
              <TaskSidebar
                selected={selected}
                onSelect={(k) => {
                  setSelected(k);
                  setSidebarOpen(false);
                }}
                refreshKey={refreshKey}
              />
            </div>
          </div>
        )}

        {/* Main */}
        <main className="flex-1 py-6 min-w-0">
          <TaskPanel key={refreshKey} spaceId={spaceId} view={view} />
        </main>
      </div>

      {/* Quick Add Dialog */}
      <QuickAddDialog
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onAdd={handleQuickAdd}
      />
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 3: 全量测试**

```bash
pnpm test
```

预期：全部既有用例 + 本计划新增用例通过。

- [ ] **Step 4: 最终验证 typecheck**

```bash
pnpm typecheck
```

预期：无错误。

- [ ] **Step 5: 更新 graphify**

```bash
graphify update .
```

- [ ] **Step 6: Commit**

```bash
git add src/app/tasks/page.tsx
git commit -m "feat(tasks): /tasks 页 flex 布局整合 TaskSidebar + TaskPanel"
```

---

## 完成后

使用 superpowers:finishing-a-development-branch 收尾（合并 / PR / 清理）。
