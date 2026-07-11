# 任务侧边栏：标签树 + 折叠全部 + 暗色配色 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在已完成的文件夹/清单树状侧边栏基础上，新增标签两级树（与清单并列）、一键展开/折叠全部文件夹、选中态改 accent 配色三项调整。

**架构：** Tag 模型加 `parentId` 自关联（严格两级）。新增 `tag-repo` 服务层封装层级校验/移动/删除语义。TaskSidebar 新增标签 section（客户端组树 + 一级走子标签并集过滤）+ 清单 header 展开折叠全部按钮 + 全局选中态换 accent。

**技术栈：** Next.js 16 / React 19 / Prisma 7 + SQLite / @dnd-kit（已有）/ vitest

## Global Constraints

- **Migration 时间戳：** `20260718000000_tag_parent_hierarchy`，必须 > `20260717000000`（task_drop_spaceid）
- **Tag.name 全局 @unique：** 父子标签也不可重名（保持现有约束）
- **严格两级：** 二级标签的 `parentId` 必须指向一级标签（即 `parent.parentId === null`）。handler 层 + zod schema 双重校验
- **Tag.parent `onDelete: Restrict`：** 删 tag 前 handler 必须先把子标签 `parentId=null` 才能删
- **TaskTag `onDelete: Cascade`：** 删 tag 时 Prisma 自动级联删 TaskTag（无需 handler 显式清）
- **选中态配色：** 所有 sidebar 选中行统一 `bg-accent text-accent-foreground font-medium`，hover 态 `hover:bg-accent/60 hover:text-foreground`
- **PRESET_TAG_COLORS：** 已存在于 `src/lib/tasks/tag-colors.ts`，TagEditDialog 复用
- **normalizeColor：** 已存在于 `src/lib/tasks/tag-colors.ts`，所有写入色值前必须走它
- **graphify-out 规则：** 涉及代码探索时先 `graphify query`，再读源文件
- **测试命令：** `pnpm test`（vitest）；**类型检查：** `pnpm typecheck`

---

## 文件结构

**新建：**
- `prisma/migrations/20260718000000_tag_parent_hierarchy/migration.sql` — Tag 加 parentId
- `src/lib/tasks/tag-repo.ts` — tag CRUD + 层级校验服务层
- `src/app/api/tags/reorder/route.ts` — 批量重排
- `src/app/api/tasks/folders/collapse-all/route.ts` — 批量折叠/展开
- `src/components/tasks/TagEditDialog.tsx` — 新建/编辑标签 dialog
- `tests/unit/tag-repo.test.ts` — 服务层测试
- `tests/api/tags-hierarchy.test.ts` — API 端到端测试

**修改：**
- `prisma/schema.prisma` — Tag 加 parentId + 自关联
- `src/app/api/tags/route.ts` — POST 接收 parentId
- `src/app/api/tags/[id]/route.ts` — PATCH 接收 parentId（移动）+ DELETE 用 tag-repo
- `src/app/api/tasks/route.ts` — GET 新增 tagId 并集过滤
- `src/app/api/tasks/counts/route.ts` — 返回 byTag
- `src/components/tasks/TaskSidebar.tsx` — 标签 section + 折叠全部 + accent
- `src/components/tasks/use-tasks.ts` — filter 加 tagId
- `src/components/tasks/TaskPanel.tsx` — props 加 tagId
- `src/app/tasks/page.tsx` — selected.tag → tagId 映射

---

### Task 1: Schema + Migration — Tag 加 parentId 自关联

**文件：**
- 修改：`prisma/schema.prisma`（Tag 模型，681-689 行）
- 创建：`prisma/migrations/20260718000000_tag_parent_hierarchy/migration.sql`

**Interfaces:**
- Produces：`Tag.parentId: string | null`、`Tag.parent?: Tag`、`Tag.children: Tag[]`（Prisma client 类型）

- [ ] **Step 1：修改 schema.prisma Tag 模型**

把 `prisma/schema.prisma` 第 681-689 行替换为：

```prisma
model Tag {
  id        String    @id @default(cuid())
  name      String    @unique
  color     String    @default("#6b7280")
  parentId  String?   // null = 一级标签；非空 = 二级标签
  sortOrder Int       @default(0)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  parent    Tag?      @relation("TagHierarchy", fields: [parentId], references: [id], onDelete: Restrict)
  children  Tag[]     @relation("TagHierarchy")
  tasks     TaskTag[]

  @@index([parentId])
}
```

- [ ] **Step 2：生成 Prisma client + 创建 migration SQL**

运行：

```bash
pnpm prisma generate
```

然后创建 `prisma/migrations/20260718000000_tag_parent_hierarchy/migration.sql`：

```sql
-- Additive migration: Tag 加 parentId 自关联（严格两级）
-- 用 new_Tag 重建模式，因为 SQLite ALTER TABLE ADD COLUMN 带 FK 不稳

PRAGMA defer_foreign_keys=ON;

CREATE TABLE new_Tag (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  parentId TEXT,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parentId) REFERENCES Tag(id) ON DELETE RESTRICT
);

-- 复制存量 tag，parentId 全部 NULL（提升为一级）
INSERT INTO new_Tag (id, name, color, parentId, sortOrder, createdAt, updatedAt)
SELECT id, name, color, NULL, sortOrder, createdAt, updatedAt FROM Tag;

-- 替换表
DROP TABLE Tag;
ALTER TABLE new_Tag RENAME TO Tag;

-- 重建索引
CREATE UNIQUE INDEX Tag_name_key ON Tag(name);
CREATE INDEX Tag_parentId_idx ON Tag(parentId);
```

- [ ] **Step 3：跑 migration 验证**

运行：

```bash
pnpm prisma migrate deploy
```

预期：`Applied migration 20260718000000_tag_parent_hierarchy`。

- [ ] **Step 4：typecheck**

运行：

```bash
pnpm typecheck
```

预期：无错误。Tag 类型现在含 `parentId: string | null`。

- [ ] **Step 5：Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260718000000_tag_parent_hierarchy/migration.sql
git commit -m "feat(schema): Tag 加 parentId 自关联支持两级树"
```

---

### Task 2: tag-repo 服务层 + 测试

**文件：**
- 创建：`src/lib/tasks/tag-repo.ts`
- 创建：`tests/unit/tag-repo.test.ts`

**Interfaces:**
- Produces：`listTagsFlat()`、`createTag({ name, color, parentId })`、`updateTag(id, patch)`、`deleteTag(id)`、`reorderTags(items)`

- [ ] **Step 1：创建 tag-repo.ts**

创建 `src/lib/tasks/tag-repo.ts`：

```ts
import { prisma } from "@/lib/db";
import { normalizeColor } from "@/lib/tasks/tag-colors";

/** 扁平查询所有 tag（含未废弃任务数 _count）。客户端自组树。 */
export async function listTagsFlat() {
  return prisma.tag.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { tasks: { where: { task: { trashed: false } } } } },
    },
  });
}

/** 创建 tag。parentId 非空时校验目标必须是一级（parent.parentId === null）。 */
export async function createTag({
  name,
  color,
  parentId,
}: {
  name: string;
  color?: string;
  parentId?: string | null;
}): Promise<{ id: string; name: string; color: string; parentId: string | null; sortOrder: number }> {
  if (parentId) {
    const parent = await prisma.tag.findUnique({ where: { id: parentId }, select: { parentId: true } });
    if (!parent) throw new Error("父标签不存在");
    if (parent.parentId !== null) throw new Error("目标父标签已是二级，禁止三级嵌套");
  }
  const maxSort = await prisma.tag.aggregate({ _max: { sortOrder: true } });
  return prisma.tag.create({
    data: {
      name,
      color: normalizeColor(color ?? "#6b7280"),
      parentId: parentId ?? null,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
    select: { id: true, name: true, color: true, parentId: true, sortOrder: true },
  });
}

/** 更新 tag。移动时校验：目标 parent 必须是一级；禁止自引用；禁止移动到自己后代下（防环）。 */
export async function updateTag(
  id: string,
  patch: { name?: string; color?: string; parentId?: string | null; sortOrder?: number }
): Promise<void> {
  // 移动校验
  if (patch.parentId !== undefined && patch.parentId !== null) {
    if (patch.parentId === id) throw new Error("不能把标签设为自己的子标签");

    // 校验目标存在且是一级
    const target = await prisma.tag.findUnique({
      where: { id: patch.parentId },
      select: { parentId: true },
    });
    if (!target) throw new Error("目标父标签不存在");
    if (target.parentId !== null) throw new Error("目标父标签已是二级，禁止三级嵌套");

    // 防环：目标不能是当前节点的后代（移动一颗子树到自己的子孙下）
    const descendants = await collectDescendants(id);
    if (descendants.has(patch.parentId)) {
      throw new Error("不能移动到自己的子标签下（会形成环）");
    }
  }

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.color !== undefined) data.color = normalizeColor(patch.color);
  if (patch.parentId !== undefined) data.parentId = patch.parentId;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;

  await prisma.tag.update({ where: { id }, data });
}

/** 递归收集某 tag 的所有后代 id（用于防环校验）。
 *  当前业务严格两级，所以最多查一层；但写法通用化以备未来。 */
async function collectDescendants(id: string): Promise<Set<string>> {
  const result = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = await prisma.tag.findMany({
      where: { parentId: current },
      select: { id: true },
    });
    for (const c of children) {
      if (!result.has(c.id)) {
        result.add(c.id);
        queue.push(c.id);
      }
    }
  }
  return result;
}

/** 删 tag：子标签提升为一级（parentId=null）+ 删该 tag。
 *  TaskTag 的清理由 Prisma `onDelete: Cascade` 自动处理。 */
export async function deleteTag(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.tag.updateMany({ where: { parentId: id }, data: { parentId: null } }),
    prisma.tag.delete({ where: { id } }),
  ]);
}

/** 批量更新 sortOrder（事务）。 */
export async function reorderTags(items: { id: string; sortOrder: number }[]): Promise<void> {
  await prisma.$transaction(
    items.map((it) => prisma.tag.update({ where: { id: it.id }, data: { sortOrder: it.sortOrder } }))
  );
}
```

- [ ] **Step 2：写测试 tests/unit/tag-repo.test.ts**

创建 `tests/unit/tag-repo.test.ts`：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  listTagsFlat,
  createTag,
  updateTag,
  deleteTag,
  reorderTags,
} from "@/lib/tasks/tag-repo";

describe("tag-repo", () => {
  beforeEach(async () => {
    await prisma.taskTag.deleteMany();
    await prisma.tag.deleteMany();
  });

  it("createTag 默认 parentId=null（一级）", async () => {
    const t = await createTag({ name: "工作" });
    expect(t.parentId).toBeNull();
    expect(t.color).toBe("#6b7280");
  });

  it("createTag parentId 指向一级 → 二级", async () => {
    const parent = await createTag({ name: "生活" });
    const child = await createTag({ name: "健身", parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
  });

  it("createTag parentId 指向二级 → 抛错（防三级）", async () => {
    const parent = await createTag({ name: "生活" });
    const child = await createTag({ name: "健身", parentId: parent.id });
    await expect(createTag({ name: "深蹲", parentId: child.id })).rejects.toThrow(
      "目标父标签已是二级，禁止三级嵌套"
    );
  });

  it("createTag parentId 不存在 → 抛错", async () => {
    await expect(createTag({ name: "孤儿", parentId: "nonexistent" })).rejects.toThrow(
      "父标签不存在"
    );
  });

  it("updateTag 移动：二级 → 一级（parentId=null）", async () => {
    const parent = await createTag({ name: "生活" });
    const child = await createTag({ name: "健身", parentId: parent.id });
    await updateTag(child.id, { parentId: null });
    const updated = await prisma.tag.findUnique({ where: { id: child.id } });
    expect(updated?.parentId).toBeNull();
  });

  it("updateTag 自引用 → 抛错", async () => {
    const t = await createTag({ name: "工作" });
    await expect(updateTag(t.id, { parentId: t.id })).rejects.toThrow(
      "不能把标签设为自己的子标签"
    );
  });

  it("updateTag 移动到二级标签下 → 抛错（防三级）", async () => {
    const parent = await createTag({ name: "生活" });
    const child = await createTag({ name: "健身", parentId: parent.id });
    const other = await createTag({ name: "读书" });
    await expect(updateTag(other.id, { parentId: child.id })).rejects.toThrow(
      "目标父标签已是二级，禁止三级嵌套"
    );
  });

  it("deleteTag 一级：子标签提升为一级", async () => {
    const parent = await createTag({ name: "生活" });
    const child = await createTag({ name: "健身", parentId: parent.id });
    await deleteTag(parent.id);
    const childAfter = await prisma.tag.findUnique({ where: { id: child.id } });
    expect(childAfter?.parentId).toBeNull();
  });

  it("deleteTag 二级：直接删除", async () => {
    const parent = await createTag({ name: "生活" });
    const child = await createTag({ name: "健身", parentId: parent.id });
    await deleteTag(child.id);
    const all = await listTagsFlat();
    expect(all.map((t) => t.id)).not.toContain(child.id);
    expect(all.map((t) => t.id)).toContain(parent.id);
  });

  it("reorderTags 批量更新 sortOrder", async () => {
    const a = await createTag({ name: "A" });
    const b = await createTag({ name: "B" });
    const c = await createTag({ name: "C" });
    await reorderTags([
      { id: c.id, sortOrder: 1 },
      { id: b.id, sortOrder: 2 },
      { id: a.id, sortOrder: 3 },
    ]);
    const all = await listTagsFlat();
    expect(all[0].id).toBe(c.id);
    expect(all[1].id).toBe(b.id);
    expect(all[2].id).toBe(a.id);
  });
});
```

- [ ] **Step 3：跑测试验证**

运行：

```bash
pnpm test tests/unit/tag-repo.test.ts
```

预期：10 个 case 全部通过。

- [ ] **Step 4：Commit**

```bash
git add src/lib/tasks/tag-repo.ts tests/unit/tag-repo.test.ts
git commit -m "feat(tasks): tag-repo 服务层支持层级校验和子提升"
```

---

### Task 3: Tag API routes（CRUD + reorder）

**文件：**
- 修改：`src/app/api/tags/route.ts`
- 修改：`src/app/api/tags/[id]/route.ts`
- 创建：`src/app/api/tags/reorder/route.ts`
- 创建：`tests/api/tags-hierarchy.test.ts`

**Interfaces:**
- Consumes：tag-repo（Task 2）
- Produces：`GET/POST /api/tags`、`PATCH/DELETE /api/tags/[id]`、`POST /api/tags/reorder`

- [ ] **Step 1：改造 GET /api/tags（返回 parentId）**

`src/app/api/tags/route.ts` 第 11-19 行的 GET 已经用 `findMany` + `orderBy`，无需改动（Prisma 自动返回新字段 parentId）。但 POST 需要接收 parentId。

把第 21-46 行的 POST 替换为：

```ts
const createSchema = z.object({
  name: z.string().trim().min(1, "标签名不能为空").max(50),
  color: z.string().optional(),
  parentId: z.string().nullable().optional(),
});

// POST /api/tags — 创建标签
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { name, color, parentId } = parsed.data;
    const tag = await createTag({ name, color, parentId: parentId ?? null });
    return NextResponse.json({ tag }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "标签名已存在" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "创建标签失败";
    // 层级校验错误统一 400
    const status =
      message.includes("父标签") || message.includes("三级") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
```

在文件顶部 import 块（第 1-5 行后）新增：

```ts
import { createTag } from "@/lib/tasks/tag-repo";
```

- [ ] **Step 2：改造 PATCH/DELETE /api/tags/[id]**

把 `src/app/api/tags/[id]/route.ts` 整个文件替换为：

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { updateTag, deleteTag } from "@/lib/tasks/tag-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: z.string().optional(),
  parentId: z.string().nullable().optional(),
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
    await updateTag(id, parsed.data);
    const tag = await prisma.tag.findUnique({ where: { id } });
    return NextResponse.json({ tag });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "标签名已存在" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "更新标签失败";
    const status =
      message.includes("父标签") ||
      message.includes("三级") ||
      message.includes("自己") ||
      message.includes("环")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE /api/tags/[id] — 子标签提升为一级，再删该 tag（TaskTag 级联清）
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await deleteTag(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除标签失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3：创建 POST /api/tags/reorder**

创建 `src/app/api/tags/reorder/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reorderTags } from "@/lib/tasks/tag-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  items: z.array(z.object({ id: z.string(), sortOrder: z.number().int() })),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await reorderTags(parsed.data.items);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4：写 API 端到端测试**

创建 `tests/api/tags-hierarchy.test.ts`：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";

describe("tags hierarchy API", () => {
  beforeEach(async () => {
    await prisma.taskTag.deleteMany();
    await prisma.tag.deleteMany();
  });

  async function postTag(body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/tags/route");
    const req = new Request("http://localhost/api/tags", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    return POST(req as never);
  }

  async function patchTag(id: string, body: Record<string, unknown>) {
    const { PATCH } = await import("@/app/api/tags/[id]/route");
    const req = new Request(`http://localhost/api/tags/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    return PATCH(req as never, { params: Promise.resolve({ id }) });
  }

  async function deleteTagApi(id: string) {
    const { DELETE } = await import("@/app/api/tags/[id]/route");
    const req = new Request(`http://localhost/api/tags/${id}`, { method: "DELETE" });
    return DELETE(req as never, { params: Promise.resolve({ id }) });
  }

  it("POST 创建一级 tag（无 parentId）", async () => {
    const res = await postTag({ name: "工作", color: "#ef4444" });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.tag.parentId).toBeNull();
    expect(data.tag.color).toBe("#ef4444");
  });

  it("POST 创建二级 tag（合法 parentId）", async () => {
    const parent = await postTag({ name: "生活" });
    const parentData = await parent.json();
    const child = await postTag({ name: "健身", parentId: parentData.tag.id });
    expect(child.status).toBe(201);
    const childData = await child.json();
    expect(childData.tag.parentId).toBe(parentData.tag.id);
  });

  it("POST 三级嵌套 → 400", async () => {
    const lv1 = await postTag({ name: "生活" });
    const lv1Data = await lv1.json();
    const lv2 = await postTag({ name: "健身", parentId: lv1Data.tag.id });
    const lv2Data = await lv2.json();
    const lv3 = await postTag({ name: "深蹲", parentId: lv2Data.tag.id });
    expect(lv3.status).toBe(400);
  });

  it("PATCH 移动：二级 → 一级（parentId=null）", async () => {
    const parent = await postTag({ name: "生活" });
    const parentData = await parent.json();
    const child = await postTag({ name: "健身", parentId: parentData.tag.id });
    const childData = await child.json();
    const res = await patchTag(childData.tag.id, { parentId: null });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.tag.parentId).toBeNull();
  });

  it("PATCH 自引用 → 400", async () => {
    const t = await postTag({ name: "工作" });
    const tData = await t.json();
    const res = await patchTag(tData.tag.id, { parentId: tData.tag.id });
    expect(res.status).toBe(400);
  });

  it("DELETE 一级 tag：子标签提升为一级", async () => {
    const parent = await postTag({ name: "生活" });
    const parentData = await parent.json();
    const child = await postTag({ name: "健身", parentId: parentData.tag.id });
    const childData = await child.json();

    const res = await deleteTagApi(parentData.tag.id);
    expect(res.status).toBe(200);

    const orphan = await prisma.tag.findUnique({ where: { id: childData.tag.id } });
    expect(orphan?.parentId).toBeNull();
  });
});
```

- [ ] **Step 5：跑测试**

运行：

```bash
pnpm test tests/api/tags-hierarchy.test.ts tests/unit/tag-repo.test.ts
```

预期：全部通过。

- [ ] **Step 6：typecheck + 全量测试**

```bash
pnpm typecheck
pnpm test
```

预期：无错误；既有测试不被破坏。

- [ ] **Step 7：Commit**

```bash
git add src/app/api/tags/route.ts src/app/api/tags/[id]/route.ts src/app/api/tags/reorder/route.ts tests/api/tags-hierarchy.test.ts
git commit -m "feat(api): tags CRUD 支持 parentId 层级 + reorder 端点"
```

---

### Task 4: Task 过滤 tagId（并集）+ counts byTag + collapse-all

**文件：**
- 修改：`src/app/api/tasks/route.ts`（GET 加 tagId）
- 修改：`src/app/api/tasks/counts/route.ts`（返回 byTag）
- 创建：`src/app/api/tasks/folders/collapse-all/route.ts`

**Interfaces:**
- Consumes：Prisma Tag 关系
- Produces：`GET /api/tasks?tagId=...`（并集）、`counts.byTag`、`POST /api/tasks/folders/collapse-all`

- [ ] **Step 1：GET /api/tasks 加 tagId 过滤**

在 `src/app/api/tasks/route.ts` 第 22-57 行的 GET 函数中：

1. 第 26 行后（`const folderId = ...` 之后）加：

```ts
const tagId = searchParams.get("tagId");
```

2. 第 49-50 行后（`if (folderId) ...` 之后）加：

```ts
if (tagId) {
  // 查该 tag + 其所有二级子 tag 的 id（并集语义）
  const childTags = await prisma.tag.findMany({
    where: { parentId: tagId },
    select: { id: true },
  });
  const allTagIds = [tagId, ...childTags.map((t) => t.id)];
  where.AND = [...(where.AND ?? []), { tags: { some: { tagId: { in: allTagIds } } } }];
}
```

注意 `where.AND` 可能已被设置（垃圾箱视图的 OR 同级），用 spread 合并。

- [ ] **Step 2：counts 加 byTag**

把 `src/app/api/tasks/counts/route.ts` 整个文件替换为：

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [active, byTagRows, trashed] = await Promise.all([
    prisma.task.groupBy({
      by: ["listId"],
      where: { trashed: false },
      _count: true,
    }),
    prisma.taskTag.groupBy({
      by: ["tagId"],
      where: { task: { trashed: false } },
      _count: true,
    }),
    prisma.task.count({
      where: {
        trashed: true,
        OR: [{ parentId: null }, { parent: { trashed: false } }],
      },
    }),
  ]);

  const byList: Record<string, number> = {};
  let total = 0;
  for (const row of active) {
    const count = row._count;
    total += count;
    if (row.listId !== null) {
      byList[row.listId] = count;
    }
  }

  const byTag: Record<string, number> = {};
  for (const row of byTagRows) {
    byTag[row.tagId] = row._count;
  }

  return NextResponse.json({ total, byList, byTag, trashed });
}
```

- [ ] **Step 3：collapse-all 端点**

创建 `src/app/api/tasks/folders/collapse-all/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  collapsed: z.boolean(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await prisma.taskFolder.updateMany({
    data: { collapsed: parsed.data.collapsed },
  });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4：typecheck + 测试**

```bash
pnpm typecheck
pnpm test
```

预期：无错误。既有 counts 测试若断言返回 shape 需要同步更新（检查 `tests/api/tasks-counts.test.ts` 是否存在；若存在且断言不含 byTag，则测试仍通过——byTag 是新增字段）。

- [ ] **Step 5：Commit**

```bash
git add src/app/api/tasks/route.ts src/app/api/tasks/counts/route.ts src/app/api/tasks/folders/collapse-all/route.ts
git commit -m "feat(api): tasks 过滤 tagId 并集 + counts byTag + collapse-all 端点"
```

---

### Task 5: 前端 SelectedKey + use-tasks + TaskPanel + page 映射

**文件：**
- 修改：`src/components/tasks/TaskSidebar.tsx`（SelectedKey 类型）
- 修改：`src/components/tasks/use-tasks.ts`（filter 加 tagId）
- 修改：`src/components/tasks/TaskPanel.tsx`（props 加 tagId）
- 修改：`src/app/tasks/page.tsx`（selected.tag → tagId）

**Interfaces:**
- Produces：`SelectedKey` 含 `{ type: "tag"; id: string }`、`useTasks` 接受 `tagId`、`TaskPanel` props `tagId?`

- [ ] **Step 1：SelectedKey 加 tag 分支**

`src/components/tasks/TaskSidebar.tsx` 第 38-42 行替换为：

```ts
export type SelectedKey =
  | { type: "all" }
  | { type: "folder"; id: string }
  | { type: "list"; id: string }
  | { type: "tag"; id: string }
  | { type: "trash" };
```

- [ ] **Step 2：use-tasks.ts filter 加 tagId**

`src/components/tasks/use-tasks.ts`：

1. 第 6-12 行 `initialFilters` 签名加 `tagId?: string;`：

```ts
export function useTasks(initialFilters?: {
  status?: string;
  listId?: string;
  folderId?: string;
  tagId?: string;
  smartView?: "today" | "next7days";
  trashed?: boolean;
}) {
```

2. 第 17-23 行 fetchTasks 内（parentId 之前）加：

```ts
if (initialFilters?.tagId) params.set("tagId", initialFilters.tagId);
```

3. 第 31 行 useCallback 依赖数组加 `initialFilters?.tagId`：

```ts
}, [initialFilters?.status, initialFilters?.listId, initialFilters?.folderId, initialFilters?.tagId, initialFilters?.smartView, initialFilters?.trashed]);
```

- [ ] **Step 3：TaskPanel props 加 tagId**

`src/components/tasks/TaskPanel.tsx`：

1. 第 14-18 行 interface 替换为：

```ts
interface TaskPanelProps {
  listId?: string;
  folderId?: string;
  tagId?: string;
  view?: "main" | "trash";
}
```

2. 第 20-28 行函数签名 + useTasks 调用替换为：

```ts
export function TaskPanel({ listId, folderId, tagId, view = "main" }: TaskPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [smartView, setSmartView] = useState<SmartView | null>(null);
  const { tasks, loading, createTask, updateTask, deleteTask, reorderTasks, toggleStatus } =
    useTasks({
      listId,
      folderId,
      tagId,
      status: statusFilter || undefined,
```

- [ ] **Step 4：page.tsx 映射 selected.tag → tagId**

`src/app/tasks/page.tsx` 第 53-56 行替换为：

```ts
const listId = selected.type === "list" ? selected.id : undefined;
const folderId = selected.type === "folder" ? selected.id : undefined;
const tagId = selected.type === "tag" ? selected.id : undefined;
const view: "main" | "trash" = selected.type === "trash" ? "trash" : "main";
```

第 116 行 TaskPanel 加 `tagId={tagId}`：

```tsx
<TaskPanel key={refreshKey} listId={listId} folderId={folderId} tagId={tagId} view={view} />
```

- [ ] **Step 5：typecheck**

```bash
pnpm typecheck
```

预期：无错误。`SelectedKey.tag` 分支目前没有产生分支，page.tsx 处理了它；TaskSidebar 还没渲染标签 section（Task 6 做），但类型已就绪。

- [ ] **Step 6：Commit**

```bash
git add src/components/tasks/TaskSidebar.tsx src/components/tasks/use-tasks.ts src/components/tasks/TaskPanel.tsx src/app/tasks/page.tsx
git commit -m "feat(tasks): 前端打通 SelectedKey.tag 分支和 tagId 过滤管道"
```

---

### Task 6: TaskSidebar 标签 section + 折叠全部 + accent 配色 + TagEditDialog

**文件：**
- 修改：`src/components/tasks/TaskSidebar.tsx`
- 创建：`src/components/tasks/TagEditDialog.tsx`

**Interfaces:**
- Consumes：Task 3（tag API）、Task 4（collapse-all API）、Task 5（SelectedKey.tag）

- [ ] **Step 1：创建 TagEditDialog.tsx**

创建 `src/components/tasks/TagEditDialog.tsx`：

```tsx
"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRESET_TAG_COLORS } from "@/lib/tasks/tag-colors";

export interface TagInfo {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
}

interface TagEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑模式传入；新建模式传 null。 */
  tag: TagInfo | null;
  /** 新建时预选的父标签 id；null = 一级。 */
  defaultParentId?: string | null;
  /** 可选父标签列表（仅一级标签 + "无（一级标签）"）。 */
  parentOptions: TagInfo[];
  onSaved: () => void;
}

export function TagEditDialog({
  open,
  onOpenChange,
  tag,
  defaultParentId,
  parentOptions,
  onSaved,
}: TagEditDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("#6b7280");
  const [parentId, setParentId] = useState<string>("__none__");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(tag?.name ?? "");
      setColor(tag?.color ?? "#6b7280");
      setParentId(tag?.parentId ?? defaultParentId ?? "__none__");
      setError(null);
    }
  }, [open, tag, defaultParentId]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("名称不能为空");
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      color,
      parentId: parentId === "__none__" ? null : parentId,
    };
    try {
      const url = tag ? `/api/tags/${tag.id}` : "/api/tags";
      const method = tag ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "保存失败");
        setSaving(false);
        return;
      }
      onSaved();
      onOpenChange(false);
      setSaving(false);
    } catch {
      setError("网络错误");
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!tag) return;
    if (!confirm(`确认删除标签「${tag.name}」？\n子标签会提升为一级，关联任务保留（仅摘掉该标签）。`)) {
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/tags/${tag.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "删除失败");
      setSaving(false);
      return;
    }
    onSaved();
    onOpenChange(false);
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tag ? "编辑标签" : "新建标签"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="tag-name">名称</Label>
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="标签名"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>颜色</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                    color === c ? "border-foreground scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`选择颜色 ${c}`}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>父标签</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger>
                <SelectValue placeholder="选择父标签" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">无（一级标签）</SelectItem>
                {parentOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          {tag && (
            <Button variant="destructive" onClick={handleDelete} disabled={saving} className="mr-auto">
              删除
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2：TaskSidebar 加载 tags + counts byTag**

在 `src/components/tasks/TaskSidebar.tsx` 顶部 import 块加：

```ts
import { TagEditDialog, type TagInfo } from "./TagEditDialog";
import { Tag as TagIcon, ChevronsDownUp, ChevronsUpDown, FolderPlus } from "lucide-react";
```

（`TagIcon` 已 import，确认不要重复声明；`ChevronsDownUp`、`ChevronsUpDown`、`FolderPlus` 是新增。）

第 50-56 行 `TaskFolderInfo` 之后加：

```ts
interface TagNode extends TagInfo {
  children?: TagNode[];
}
```

第 254-260 行（`export function TaskSidebar` 内）的 state 块加：

```ts
const [tags, setTags] = useState<TagInfo[]>([]);
const [collapsedTagIds, setCollapsedTagIds] = useState<Set<string>>(new Set());
const [tagDialogOpen, setTagDialogOpen] = useState(false);
const [editTag, setEditTag] = useState<TagInfo | null>(null);
const [tagDialogParentId, setTagDialogParentId] = useState<string | null>(null);
```

第 271-289 行 `load` 函数中，`Promise.all` 数组加 `fetch("/api/tags")`：

```ts
const [treeRes, countRes, tagsRes] = await Promise.all([
  fetch("/api/tasks/folders"),
  fetch("/api/tasks/counts"),
  fetch("/api/tags"),
]);
if (tagsRes.ok) {
  const data = await tagsRes.json();
  setTags(data.tags ?? []);
}
```

第 257-261 行 `counts` state 类型加 `byTag`：

```ts
const [counts, setCounts] = useState<Counts>({
  total: 0,
  byList: {},
  byTag: {},
  trashed: 0,
});
```

第 58-62 行 `Counts` 类型加 `byTag`：

```ts
type Counts = {
  total: number;
  byList: Record<string, number>;
  byTag: Record<string, number>;
  trashed: number;
};
```

第 282-288 行 setCounts 加 `byTag`：

```ts
setCounts({
  total: c.total,
  byList: c.byList ?? {},
  byTag: c.byTag ?? {},
  trashed: c.trashed,
});
```

- [ ] **Step 3：客户端组树 + 计数 helper**

在 `toggleCollapsed` 函数之前（约第 301 行）加：

```ts
const tagTree = useMemo<TagNode[]>(() => {
  const roots = tags.filter((t) => t.parentId === null);
  return roots.map((r) => ({
    ...r,
    children: tags
      .filter((t) => t.parentId === r.id)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}, [tags]);

const tagCount = (t: TagInfo): number => {
  const direct = counts.byTag[t.id] ?? 0;
  if (t.parentId === null) {
    // 一级：加所有子标签
    const children = tags.filter((c) => c.parentId === t.id);
    return direct + children.reduce((sum, c) => sum + (counts.byTag[c.id] ?? 0), 0);
  }
  return direct;
};

const parentTagOptions = tags.filter((t) => t.parentId === null);

const toggleTagCollapsed = (id: string) => {
  setCollapsedTagIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
};

const openTagDialog = (parentId: string | null) => {
  setEditTag(null);
  setTagDialogParentId(parentId);
  setTagDialogOpen(true);
};

const editTagHandler = (t: TagInfo) => {
  setEditTag(t);
  setTagDialogParentId(null);
  setTagDialogOpen(true);
};
```

- [ ] **Step 4：展开/折叠全部按钮 helper**

在 `tagCount` 之后加：

```ts
const allFoldersExpanded =
  folders.length > 0 && folders.every((f) => !f.collapsed);

const toggleAllFoldersCollapsed = async () => {
  const nextCollapsed = allFoldersExpanded; // 全展开 → 点 = 全收起
  // 乐观更新
  setFolders((fs) => fs.map((f) => ({ ...f, collapsed: nextCollapsed })));
  await fetch("/api/tasks/folders/collapse-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collapsed: nextCollapsed }),
  });
};
```

- [ ] **Step 5：清单 section header 加折叠全部按钮**

找到「清单」section header（约第 435-453 行的 `<div className="flex items-center justify-between px-2">` 块）。替换为：

```tsx
<div className="flex items-center justify-between px-2">
  <span className="text-xs text-muted-foreground">清单</span>
  <div className="flex items-center gap-1">
    {folders.length > 0 && (
      <button
        onClick={toggleAllFoldersCollapsed}
        className="p-0.5 rounded hover:bg-accent text-muted-foreground"
        title={allFoldersExpanded ? "折叠全部文件夹" : "展开全部文件夹"}
      >
        {allFoldersExpanded ? (
          <ChevronsDownUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5" />
        )}
      </button>
    )}
    <button
      onClick={() => setFolderDialogOpen(true)}
      className="p-0.5 rounded hover:bg-accent text-muted-foreground"
      title="新建文件夹"
    >
      <FolderOpen className="h-3.5 w-3.5" />
    </button>
    <button
      onClick={() => openListDialog(null)}
      className="p-0.5 rounded hover:bg-accent text-muted-foreground"
      title="新建清单"
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  </div>
</div>
```

- [ ] **Step 6：选中态全部改为 accent（5 处）**

全局替换（在 `src/components/tasks/TaskSidebar.tsx` 中，用 Edit `replace_all`）：

- `bg-primary text-primary-foreground` → `bg-accent text-accent-foreground font-medium`
- `hover:bg-accent hover:text-foreground`（非选中态） → `hover:bg-accent/60 hover:text-foreground`

涉及位置：全部任务按钮（第 419-423 行）、SortableFolderRow（第 118-122 行）、SortableListRow（第 211-216 行）、垃圾箱按钮（第 551-556 行）。

- [ ] **Step 7：新增标签 section（插在垃圾箱分隔线之前）**

找到 `{/* 文件夹（含内部清单）... */}` DndContext 结束的 `</DndContext>` 之后、`<div className="h-px bg-border my-1" />` 垃圾箱分隔线之前（约第 546-548 行）。插入标签 section：

```tsx
<div className="h-px bg-border my-1" />

<div className="flex items-center justify-between px-2">
  <span className="text-xs text-muted-foreground">标签</span>
  <div className="flex items-center gap-1">
    <button
      onClick={() => openTagDialog(null)}
      className="p-0.5 rounded hover:bg-accent text-muted-foreground"
      title="新建一级标签"
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  </div>
</div>

{tagTree.map((tag) => {
  const isSelected = selected.type === "tag" && selected.id === tag.id;
  const isCollapsed = collapsedTagIds.has(tag.id);
  const hasChildren = (tag.children?.length ?? 0) > 0;
  const count = tagCount(tag);
  return (
    <div key={tag.id} className="space-y-0.5">
      <div
        className={cn(
          "group flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer",
          isSelected
            ? "bg-accent text-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        )}
        onClick={() => onSelect({ type: "tag", id: tag.id })}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleTagCollapsed(tag.id);
            }}
            className="p-0.5 rounded hover:bg-accent"
            title={isCollapsed ? "展开" : "收起"}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: tag.color }}
        />
        <span className="flex-1 text-left truncate">{tag.name}</span>
        {count > 0 && <span className="text-xs shrink-0">{count}</span>}
        <button
          onClick={(e) => {
            e.stopPropagation();
            openTagDialog(tag.id);
          }}
          className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 shrink-0"
          title="新建子标签"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            editTagHandler(tag);
          }}
          className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 shrink-0"
          title="编辑标签"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      {hasChildren && !isCollapsed && (
        <div className="pl-6 space-y-0.5">
          {tag.children!.map((child) => {
            const childSelected =
              selected.type === "tag" && selected.id === child.id;
            const childCount = tagCount(child);
            return (
              <div
                key={child.id}
                className={cn(
                  "group flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer",
                  childSelected
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
                onClick={() => onSelect({ type: "tag", id: child.id })}
              >
                <span className="w-5" />
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: child.color }}
                />
                <span className="flex-1 text-left truncate">{child.name}</span>
                {childCount > 0 && (
                  <span className="text-xs shrink-0">{childCount}</span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    editTagHandler(child);
                  }}
                  className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 shrink-0"
                  title="编辑标签"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
})}
```

- [ ] **Step 8：在底部 dialogs 块加 TagEditDialog**

在 TaskListDialog 之后（约第 588-600 行的 `</TaskListDialog>` 之后，`</aside>` 之前）加：

```tsx
<TagEditDialog
  open={tagDialogOpen || editTag !== null}
  onOpenChange={(o) => {
    if (!o) {
      setTagDialogOpen(false);
      setEditTag(null);
    }
  }}
  tag={editTag}
  defaultParentId={tagDialogParentId}
  parentOptions={parentTagOptions}
  onSaved={load}
/>
```

- [ ] **Step 9：typecheck + 全量测试**

```bash
pnpm typecheck
pnpm test
```

预期：无错误。所有既有测试通过。

- [ ] **Step 10：Commit**

```bash
git add src/components/tasks/TaskSidebar.tsx src/components/tasks/TagEditDialog.tsx
git commit -m "feat(tasks): TaskSidebar 标签 section + 折叠全部 + accent 配色"
```

---

## 自检

**1. 规格覆盖度：**

- ✅ Tag 加 parentId 两级树 → Task 1 + Task 2 + Task 3
- ✅ 标签与清单并列 → Task 6 Step 7（标签 section）
- ✅ 一级标签点击走子标签并集 → Task 4 Step 1（tagId 并集过滤）+ Task 6 Step 7（点击 onSelect tag）
- ✅ 展开/折叠全部文件夹 → Task 4 Step 3（collapse-all API）+ Task 6 Step 4-5（按钮）
- ✅ 暗模式选中态改 accent → Task 6 Step 6（全局替换）
- ✅ 标签 CRUD 入口 → Task 6 Step 1（TagEditDialog）+ Step 7（行内 ⋯ 菜单）

**2. 占位符扫描：** 无 TBD/TODO，所有 code step 都有完整代码。

**3. 类型一致性：**

- `SelectedKey` 在 Task 5 定义 `{ type: "tag"; id: string }`，Task 6 使用 `onSelect({ type: "tag", id: tag.id })` ✓
- `TagInfo` 在 `TagEditDialog.tsx` 定义 `{ id, name, color, parentId }`，TaskSidebar import 复用 ✓
- `tagCount` 一级聚合逻辑与 spec「一级 = 自身 + 子标签」一致 ✓
- counts `byTag` 类型从 Task 4 贯通到 TaskSidebar state ✓

**4. 风险已处理：**

- Tag.parentId FK Restrict → deleteTag 先 updateMany 子标签 parentId=null ✓
- 防三级 → createTag/updateTag 校验 parent.parentId === null ✓
- 防环 → updateTag collectDescendants 校验 ✓
- where.AND 合并 → Task 4 Step 1 用 spread 不覆盖已有条件 ✓

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-07-11-task-sidebar-tag-tree.md`。两种执行方式：

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

**选哪种方式？**
