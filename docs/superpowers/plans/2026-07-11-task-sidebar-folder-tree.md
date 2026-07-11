# 任务侧边栏文件夹+清单树状重构 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将任务侧边栏从「复用 Space 的扁平列表」重构为「TaskFolder → TaskList 两级树状结构」，参考滴答清单交互，移除收集箱，Task 从 Space 完全解耦。

**架构：** 新增 `TaskFolder` + `TaskList` 两张表；`Task.spaceId` 替换为 `Task.listId`（必填）。API 新增 folders/lists CRUD + reorder。前端 TaskSidebar 重写为可展开/收起的树，支持 dnd-kit 拖拽排序。采用「先加后删」策略：先添加 listId 并回填，前后端逐步切换到 listId，最后一次性删除 spaceId。

**技术栈：** Next.js 16 / React 19 / Prisma 7 + SQLite / vitest / @dnd-kit（已装）

**规格：** `docs/superpowers/specs/2026-07-11-task-sidebar-folder-tree-design.md`

## 全局约束

- **graphify 规则**：读源码前先 `graphify query`（CLAUDE.md 强制）
- **migration 时间戳**：新 migration 必须 `> 20260715`（task_phase_b_tags_trash），用 `20260716000000`（additive）和 `20260717000000`（drop spaceId）。自定义 migration runner 按目录名排序
- **DB URL**：Prisma CLI 用 `DATABASE_URL="file:./dev.db"`；测试用临时 DB
- **commit 风格**：`feat(tasks): ...` / `fix(migration): ...`，HEREDOC 传消息，末尾 `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
- **颜色色板**：复用 `src/components/tasks/TagManageDialog.tsx` 的 `PRESET_TAG_COLORS`（8 色 `as const`）
- **每个任务结束后**：`pnpm typecheck` 必须无错（除非该任务明确标注为「red 窗口」）
- **删除语义**：`onDelete: Restrict` + handler 先清理子记录（删 folder → list 提升顶层；删 list → task 软删进垃圾箱）
- **YAGNI**：不做清单图标自定义；不做清单内视图切换

---

## 文件结构

**新建：**
- `prisma/migrations/20260716000000_task_folder_list_additive/migration.sql` — 建 TaskFolder/TaskList 表 + 加 listId 列 + 回填
- `prisma/migrations/20260717000000_task_drop_spaceid/migration.sql` — 删 spaceId + listId 必填
- `src/lib/tasks/list-repo.ts` — folder/list CRUD + reorder 服务层
- `src/app/api/tasks/folders/route.ts` — GET 全树、POST 新建 folder
- `src/app/api/tasks/folders/[id]/route.ts` — PATCH、DELETE folder
- `src/app/api/tasks/folders/reorder/route.ts` — POST 批量重排 folder
- `src/app/api/tasks/lists/route.ts` — POST 新建 list
- `src/app/api/tasks/lists/[id]/route.ts` — PATCH、DELETE list
- `src/app/api/tasks/lists/reorder/route.ts` — POST 批量重排 list（含跨父级移动）
- `src/components/tasks/TaskListDialog.tsx` — 新建/编辑清单（名称+色板+文件夹下拉）
- `src/components/tasks/TaskFolderDialog.tsx` — 新建/重命名文件夹
- 测试：`tests/unit/list-repo.test.ts`、`tests/api/tasks-folders-lists.test.ts`

**修改：**
- `prisma/schema.prisma` — 加 TaskFolder/TaskList，改 Task
- `src/app/api/tasks/route.ts` — spaceId→listId/folderId，去 smartView=inbox
- `src/app/api/tasks/[id]/route.ts` — listId 字段
- `src/app/api/tasks/counts/route.ts` — byList，去 inbox
- `src/lib/tasks/smart-views.ts` — 去 inbox
- `src/components/tasks/types.ts` — Task.spaceId→listId + list 对象形状
- `src/components/tasks/use-tasks.ts` — spaceId→listId/folderId
- `src/components/tasks/TaskPanel.tsx` — props listId/folderId，去 inbox 分段
- `src/components/tasks/QuickAddDialog.tsx` — 加清单选择器（必填）
- `src/components/tasks/TrashView.tsx` — task.space→task.list
- `src/components/tasks/TaskSidebar.tsx` — 重写为树 + DnD + dialogs
- `src/app/tasks/page.tsx` — SelectedKey 适配

---

### Task 1: Schema additive + Migration A（additive）

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260716000000_task_folder_list_additive/migration.sql`

**Interfaces:**
- Produces: `TaskFolder`、`TaskList` Prisma 模型；`Task.listId`（可空，已回填到默认清单）

- [ ] **Step 1: 修改 prisma/schema.prisma**

在 `model Tag` 之前新增两个 model；修改 `model Task`。

新增（放在 `model Task` 之后、`model Tag` 之前）：

```prisma
model TaskFolder {
  id        String   @id @default(cuid())
  name      String
  sortOrder Int      @default(0)
  collapsed Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  lists     TaskList[]

  @@index([sortOrder])
}

model TaskList {
  id        String   @id @default(cuid())
  name      String
  color     String   @default("#6b7280")
  folderId  String?
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  folder    TaskFolder? @relation(fields: [folderId], references: [id], onDelete: Restrict)
  tasks     Task[]

  @@index([folderId])
  @@index([sortOrder])
}
```

修改 `model Task`（找到 `spaceId String?` 那行附近）：
- 在 `spaceId String? // 关联空间` 这一行下面新增 `listId String? // 关联任务清单`
- 在 `space Space? @relation(fields: [spaceId], references: [id])` 下面新增 `list TaskList? @relation(fields: [listId], references: [id], onDelete: Restrict)`
- 在 `@@index([spaceId, status, sortOrder])` 下面新增 `@@index([listId, status, sortOrder])`

**注意：** 此时 spaceId 与 listId 并存，typecheck 绿。

- [ ] **Step 2: 创建 migration SQL**

创建 `prisma/migrations/20260716000000_task_folder_list_additive/migration.sql`：

```sql
-- CreateTable TaskFolder
CREATE TABLE "TaskFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable TaskList
CREATE TABLE "TaskList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "folderId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskList_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "TaskFolder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 种子默认清单（固定 id，便于回填 listId）
INSERT INTO "TaskList" ("id", "name", "color", "folderId", "sortOrder", "createdAt", "updatedAt")
VALUES ('cl_default_list_seed_fixed', '默认清单', '#6b7280', NULL, 0, datetime('now'), datetime('now'));

-- 给 Task 加 listId 列（先可空）
ALTER TABLE "Task" ADD COLUMN "listId" TEXT;

-- 回填：所有 listId 为空的指向默认清单
UPDATE "Task" SET "listId" = 'cl_default_list_seed_fixed' WHERE "listId" IS NULL;

-- 索引
CREATE INDEX "TaskFolder_sortOrder_idx" ON "TaskFolder"("sortOrder");
CREATE INDEX "TaskList_folderId_idx" ON "TaskList"("folderId");
CREATE INDEX "TaskList_sortOrder_idx" ON "TaskList"("sortOrder");
CREATE INDEX "Task_listId_status_sortOrder_idx" ON "Task"("listId", "status", "sortOrder");
```

- [ ] **Step 3: 应用 migration 到 dev.db + 重新生成 Prisma client**

```bash
DATABASE_URL="file:./dev.db" pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

预期：migration 成功应用；Prisma client 重新生成包含 TaskFolder/TaskList。

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

预期：无错误（listId 可空，spaceId 仍存在）。

- [ ] **Step 5: 运行已有测试确认未破坏**

```bash
pnpm test
```

预期：全部既有用例通过。

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260716000000_task_folder_list_additive
git commit -m "$(cat <<'EOF'
feat(tasks): 新增 TaskFolder/TaskList 模型 + Task.listId（additive）

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: list-repo 服务层 + 单元测试

**Files:**
- Create: `src/lib/tasks/list-repo.ts`
- Create: `tests/unit/list-repo.test.ts`

**Interfaces:**
- Consumes: `prisma`（TaskFolder、TaskList、Task 模型）、`computeExpiresAt`（trash-lifecycle）
- Produces: `listFoldersWithLists()`、`createFolder/renameFolder/deleteFolder/reorderFolders`、`createList/updateList/deleteList/reorderLists`

- [ ] **Step 1: 创建 src/lib/tasks/list-repo.ts**

```ts
import { prisma } from "@/lib/db";
import { computeExpiresAt } from "@/lib/tasks/trash-lifecycle";

/** 全树：folders（含嵌套 lists）+ standaloneLists（folderId=null 的清单），按 sortOrder 排序。 */
export async function listFoldersWithLists() {
  const [folders, standaloneLists] = await Promise.all([
    prisma.taskFolder.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: {
        lists: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        },
      },
    }),
    prisma.taskList.findMany({
      where: { folderId: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
  ]);
  return { folders, standaloneLists };
}

export async function createFolder(name: string) {
  const maxSort = await prisma.taskFolder.aggregate({ _max: { sortOrder: true } });
  return prisma.taskFolder.create({
    data: { name, sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
  });
}

export async function renameFolder(id: string, name: string) {
  return prisma.taskFolder.update({ where: { id }, data: { name } });
}

export async function setFolderCollapsed(id: string, collapsed: boolean) {
  return prisma.taskFolder.update({ where: { id }, data: { collapsed } });
}

/** 删 folder：其下 list 提升为顶层（folderId=null），再删 folder。 */
export async function deleteFolder(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.taskList.updateMany({ where: { folderId: id }, data: { folderId: null } }),
    prisma.taskFolder.delete({ where: { id } }),
  ]);
}

/** 批量更新 folder sortOrder（事务）。 */
export async function reorderFolders(items: { id: string; sortOrder: number }[]): Promise<void> {
  await prisma.$transaction(
    items.map((it) => prisma.taskFolder.update({ where: { id: it.id }, data: { sortOrder: it.sortOrder } }))
  );
}

export async function createList({ name, color, folderId }: { name: string; color?: string; folderId?: string | null }) {
  const maxSort = await prisma.taskList.aggregate({ _max: { sortOrder: true } });
  return prisma.taskList.create({
    data: {
      name,
      color: color ?? "#6b7280",
      folderId: folderId ?? null,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });
}

export async function updateList(
  id: string,
  patch: { name?: string; color?: string; folderId?: string | null; sortOrder?: number }
) {
  return prisma.taskList.update({ where: { id }, data: patch });
}

/** 删 list：其下 task 重指到默认清单 + 软删进垃圾箱，再删 list。
 *  因为 listId NOT NULL + onDelete: Restrict，必须先把 task 挪走才能删 list。 */
export const DEFAULT_LIST_ID = "cl_default_list_seed_fixed";

export async function deleteList(id: string): Promise<void> {
  if (id === DEFAULT_LIST_ID) {
    throw new Error("默认清单不可删除");
  }
  const now = new Date();
  const expiresAt = computeExpiresAt(now);
  await prisma.$transaction([
    prisma.task.updateMany({
      where: { listId: id },
      data: { listId: DEFAULT_LIST_ID, trashed: true, trashedAt: now, expiresAt },
    }),
    prisma.taskList.delete({ where: { id } }),
  ]);
}

/** 批量更新 list sortOrder + folderId（跨父级移动，事务）。 */
export async function reorderLists(
  items: { id: string; sortOrder: number; folderId?: string | null }[]
): Promise<void> {
  await prisma.$transaction(
    items.map((it) =>
      prisma.taskList.update({
        where: { id: it.id },
        data: { sortOrder: it.sortOrder, ...(it.folderId !== undefined ? { folderId: it.folderId } : {}) },
      })
    )
  );
}
```

- [ ] **Step 2: 创建 tests/unit/list-repo.test.ts**

参考既有 `tests/unit/` 测试的 DB 初始化模式。先看一个既有测试文件确认 vitest setup：

```bash
ls tests/unit/
```

读一个现有测试（如 `tests/unit/tag-repo.test.ts` 或类似的 task 测试）确认 prisma test client 初始化方式后，写：

```ts
import { describe, it, expect, beforeEach } from "vitest";
// 按既有测试模式 import prisma 测试客户端
import { prisma } from "@/lib/db";
import {
  listFoldersWithLists,
  createFolder,
  renameFolder,
  deleteFolder,
  reorderFolders,
  createList,
  updateList,
  deleteList,
  reorderLists,
} from "@/lib/tasks/list-repo";

describe("list-repo", () => {
  beforeEach(async () => {
    await prisma.task.deleteMany();
    await prisma.taskList.deleteMany();
    await prisma.taskFolder.deleteMany();
  });

  it("createFolder + listFoldersWithLists 返回树", async () => {
    const f = await createFolder("工作");
    const tree = await listFoldersWithLists();
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0].id).toBe(f.id);
    expect(tree.standaloneLists).toHaveLength(0);
  });

  it("deleteFolder 把其下 list 提升为顶层", async () => {
    const f = await createFolder("工作");
    const l = await createList({ name: "OKR", folderId: f.id });
    await deleteFolder(f.id);
    const tree = await listFoldersWithLists();
    expect(tree.folders).toHaveLength(0);
    expect(tree.standaloneLists).toHaveLength(1);
    expect(tree.standaloneLists[0].id).toBe(l.id);
    expect(tree.standaloneLists[0].folderId).toBeNull();
  });

  it("deleteList 把其下 task 重指默认清单 + 软删进垃圾箱", async () => {
    const l = await createList({ name: "清单A" });
    const t = await prisma.task.create({ data: { title: "任务1", listId: l.id } });
    await deleteList(l.id);
    const after = await prisma.task.findUnique({ where: { id: t.id } });
    expect(after?.trashed).toBe(true);
    expect(after?.trashedAt).toBeTruthy();
    expect(after?.expiresAt).toBeTruthy();
    expect(after?.listId).toBe(DEFAULT_LIST_ID); // 重指到默认清单
    // list 已删
    const listExists = await prisma.taskList.findUnique({ where: { id: l.id } });
    expect(listExists).toBeNull();
  });

  it("deleteList 拒绝删除默认清单", async () => {
    await expect(deleteList(DEFAULT_LIST_ID)).rejects.toThrow();
  });

  it("reorderLists 支持跨父级移动（folderId 变更）", async () => {
    const f1 = await createFolder("F1");
    const f2 = await createFolder("F2");
    const l = await createList({ name: "L1", folderId: f1.id });
    await reorderLists([{ id: l.id, sortOrder: 0, folderId: f2.id }]);
    const after = await prisma.taskList.findUnique({ where: { id: l.id } });
    expect(after?.folderId).toBe(f2.id);
  });

  it("reorderFolders 批量更新 sortOrder", async () => {
    const a = await createFolder("A");
    const b = await createFolder("B");
    await reorderFolders([{ id: b.id, sortOrder: 1 }, { id: a.id, sortOrder: 2 }]);
    const aa = await prisma.taskFolder.findUnique({ where: { id: a.id } });
    const bb = await prisma.taskFolder.findUnique({ where: { id: b.id } });
    expect(aa?.sortOrder).toBe(2);
    expect(bb?.sortOrder).toBe(1);
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm test tests/unit/list-repo.test.ts
```

预期：全部通过。若 FK 冲突，按 Step 2 注意事项修正 deleteList（listId 置 null 再删 list）。

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/list-repo.ts tests/unit/list-repo.test.ts
git commit -m "$(cat <<'EOF'
feat(tasks): list-repo 服务层 + folder/list CRUD/reorder 单测

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Folders + Lists API 路由 + 测试

**Files:**
- Create: `src/app/api/tasks/folders/route.ts`
- Create: `src/app/api/tasks/folders/[id]/route.ts`
- Create: `src/app/api/tasks/folders/reorder/route.ts`
- Create: `src/app/api/tasks/lists/route.ts`
- Create: `src/app/api/tasks/lists/[id]/route.ts`
- Create: `src/app/api/tasks/lists/reorder/route.ts`
- Create: `tests/api/tasks-folders-lists.test.ts`

**Interfaces:**
- Consumes: `list-repo.ts`（Task 2）
- Produces: 6 个 API 端点（见规格 API 节）

- [ ] **Step 1: 创建 folders/route.ts（GET 全树 + POST 新建）**

`src/app/api/tasks/folders/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listFoldersWithLists, createFolder } from "@/lib/tasks/list-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const tree = await listFoldersWithLists();
  return NextResponse.json(tree);
}

const createFolderSchema = z.object({ name: z.string().min(1).max(100) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = createFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const folder = await createFolder(parsed.data.name);
  return NextResponse.json({ folder }, { status: 201 });
}
```

- [ ] **Step 2: 创建 folders/[id]/route.ts（PATCH + DELETE）**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { renameFolder, setFolderCollapsed, deleteFolder } from "@/lib/tasks/list-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  collapsed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, collapsed, sortOrder } = parsed.data;
  if (name !== undefined) await renameFolder(id, name);
  if (collapsed !== undefined) await setFolderCollapsed(id, collapsed);
  if (sortOrder !== undefined) {
    const { reorderFolders } = await import("@/lib/tasks/list-repo");
    await reorderFolders([{ id, sortOrder }]);
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await deleteFolder(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "删除文件夹失败" }, { status: 500 });
  }
}
```

- [ ] **Step 3: 创建 folders/reorder/route.ts**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reorderFolders } from "@/lib/tasks/list-repo";

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
  await reorderFolders(parsed.data.items);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: 创建 lists/route.ts（POST 新建）**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createList } from "@/lib/tasks/list-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().optional(),
  folderId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const list = await createList({
    name: parsed.data.name,
    color: parsed.data.color,
    folderId: parsed.data.folderId,
  });
  return NextResponse.json({ list }, { status: 201 });
}
```

- [ ] **Step 5: 创建 lists/[id]/route.ts（PATCH + DELETE）**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateList, deleteList } from "@/lib/tasks/list-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().optional(),
  folderId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const list = await updateList(id, parsed.data);
  return NextResponse.json({ list });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await deleteList(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "删除清单失败" }, { status: 500 });
  }
}
```

- [ ] **Step 6: 创建 lists/reorder/route.ts**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reorderLists } from "@/lib/tasks/list-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      sortOrder: z.number().int(),
      folderId: z.string().nullable().optional(),
    })
  ),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await reorderLists(parsed.data.items);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 7: API 测试**

创建 `tests/api/tasks-folders-lists.test.ts`。先读一个既有 API 测试确认如何起 Next.js Route Handler 测试（`tests/api/` 下的现有文件），然后写覆盖 GET 全树 / POST folder / POST list / DELETE folder（清单提升）/ DELETE list（task 软删）/ reorder 的用例。

```bash
ls tests/api/
```

读 `tests/api/` 下任一 task 相关测试文件，复用其 import 模式与 fetch/invoke 方式。

- [ ] **Step 8: 运行测试 + typecheck**

```bash
pnpm test tests/api/tasks-folders-lists.test.ts
pnpm typecheck
```

- [ ] **Step 9: Commit**

```bash
git add src/app/api/tasks/folders src/app/api/tasks/lists tests/api/tasks-folders-lists.test.ts
git commit -m "$(cat <<'EOF'
feat(tasks): folders/lists API 路由（CRUD + reorder）+ 测试

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 后端桥接（tasks API + counts 同时返回 listId 与 spaceId）

**Files:**
- Modify: `src/app/api/tasks/route.ts`
- Modify: `src/app/api/tasks/[id]/route.ts`
- Modify: `src/app/api/tasks/counts/route.ts`

**目标：** 后端响应同时包含 listId/list 与既有 spaceId 字段；接受 listId/folderId 查询参数。前端逐步切到 listId，此期间 typecheck 绿。

- [ ] **Step 1: 修改 src/app/api/tasks/route.ts**

`createSchema`：`spaceId` 后新增 `listId: z.string().nullable().optional()`。

GET handler 改动：
- 读取 `const listId = searchParams.get("listId");` 和 `const folderId = searchParams.get("folderId");`
- where 中：原 `if (spaceId) where.spaceId = spaceId;` 下方新增 `if (listId) where.listId = listId;`；新增 `if (folderId) where.list = { folderId };`
- 删除 `else if (smartView === "inbox") where.spaceId = null;`（保留 smartView 分支供 today/next7days；inbox 后续移除，但此任务暂不动 smart-views）
- `include` 中新增 `list: { select: { id: true, name: true, color: true, folderId: true, folder: { select: { id: true, name: true } } } }`（保留 space select 不动）

POST handler 改动：
- 解构新增 `listId`
- `prisma.task.create` data 中新增 `listId: listId ?? null`（保留 spaceId ?? null）

- [ ] **Step 2: 修改 src/app/api/tasks/[id]/route.ts**

`updateSchema` 新增 `listId: z.string().nullable().optional()`。

PATCH handler：解构新增 `listId`，`if (listId !== undefined) data.listId = listId;`。

- [ ] **Step 3: 修改 src/app/api/tasks/counts/route.ts**

返回 `{ total, inbox, bySpace, byList, trashed }`（superset，byList 新增）：

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const active = await prisma.task.groupBy({
    by: ["listId"],
    where: { trashed: false },
    _count: true,
  });

  const byList: Record<string, number> = {};
  let total = 0;
  for (const row of active) {
    const count = row._count;
    total += count;
    if (row.listId !== null) {
      byList[row.listId] = count;
    }
  }

  // legacy bySpace + inbox（桥接期保留，Task 9 移除）
  const bySpaceActive = await prisma.task.groupBy({
    by: ["spaceId"],
    where: { trashed: false },
    _count: true,
  });
  const bySpace: Record<string, number> = {};
  let inbox = 0;
  for (const row of bySpaceActive) {
    const count = row._count;
    if (row.spaceId === null) inbox += count;
    else bySpace[row.spaceId] = count;
  }

  const trashed = await prisma.task.count({
    where: {
      trashed: true,
      OR: [{ parentId: null }, { parent: { trashed: false } }],
    },
  });

  return NextResponse.json({ total, inbox, bySpace, byList, trashed });
}
```

- [ ] **Step 4: 运行相关测试 + typecheck**

```bash
pnpm test tests/api/tasks
pnpm typecheck
```

预期：既有用例仍通过（superset 兼容）。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tasks/route.ts src/app/api/tasks/[id]/route.ts src/app/api/tasks/counts/route.ts
git commit -m "$(cat <<'EOF'
feat(tasks): 后端桥接——tasks API 接受 listId/folderId，counts 返回 byList

保留 spaceId 字段与 bySpace/inbox 供前端逐步切换。Task 9 统一移除。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 前端切换 part 1（types + use-tasks + TaskPanel + page/SelectedKey）

**Files:**
- Modify: `src/components/tasks/types.ts`
- Modify: `src/components/tasks/use-tasks.ts`
- Modify: `src/components/tasks/TaskPanel.tsx`
- Modify: `src/app/tasks/page.tsx`

**目标：** 前端 Task 类型与 hooks 从 spaceId 切到 listId/folderId；SelectedKey 增加 folder/list 类型。此任务后前端不再读 task.spaceId。

- [ ] **Step 1: 修改 src/components/tasks/types.ts**

把 `spaceId: string | null;` 改为 `listId: string;`；把 `space?: { id: string; name: string } | null;` 改为：

```ts
list?: { id: string; name: string; color: string; folderId: string | null; folder?: { id: string; name: string } | null };
```

- [ ] **Step 2: 修改 src/components/tasks/use-tasks.ts**

`initialFilters` 类型：`spaceId?: string` 改为 `listId?: string` + `folderId?: string`。移除 `smartView?: "today" | "next7days" | "inbox"` 中的 `"inbox"`（改为 `"today" | "next7days"`）。

`fetchTasks`：
- `if (initialFilters?.spaceId) params.set("spaceId", ...)` 改为 `if (initialFilters?.listId) params.set("listId", initialFilters.listId);`
- 新增 `if (initialFilters?.folderId) params.set("folderId", initialFilters.folderId);`

`createTask` data 类型：`spaceId?: string | null` 改为 `listId?: string | null`。

依赖数组更新为 `initialFilters?.status, initialFilters?.listId, initialFilters?.folderId, initialFilters?.smartView, initialFilters?.trashed`。

- [ ] **Step 3: 修改 src/components/tasks/TaskPanel.tsx**

`TaskPanelProps`：`spaceId?: string` 改为 `listId?: string` + `folderId?: string`。

函数签名 `TaskPanel({ spaceId, view = "main" })` 改为 `TaskPanel({ listId, folderId, view = "main" })`。

`useTasks({ spaceId, ... })` 改为 `useTasks({ listId, folderId, ... })`。

智能视图分段控件：移除 `{ key: "inbox", label: "收集箱" }` 那一项（保留 全部/今天/最近7天）。

- [ ] **Step 4: 修改 src/app/tasks/page.tsx**

`SelectedKey` 不在本文件定义（在 TaskSidebar），但本文件 import 与使用。先把 `selected.type === "space"` 的映射改为支持 folder/list：

```ts
const listId = selected.type === "list" ? selected.id : undefined;
const folderId = selected.type === "folder" ? selected.id : undefined;
const view: "main" | "trash" = selected.type === "trash" ? "trash" : "main";
```

TaskPanel props：`<TaskPanel key={refreshKey} listId={listId} folderId={folderId} view={view} />`。

`handleQuickAdd` 的 data 类型加 `listId: string`（QuickAddDialog 改造在 Task 6，本任务先在类型上加 optional `listId?: string`，POST body 传 `listId: data.listId ?? null`）。

- [ ] **Step 5: 修改 src/components/tasks/TaskSidebar.tsx 的 SelectedKey 类型（仅类型，渲染逻辑在 Task 6）**

当前 TaskSidebar 仍按旧逻辑渲染（fetch /api/spaces），但 `SelectedKey` 类型要更新以让 page.tsx 编译：

```ts
export type SelectedKey =
  | { type: "all" }
  | { type: "folder"; id: string }
  | { type: "list"; id: string }
  | { type: "trash" };
```

移除 `{ type: "inbox" }` 和 `{ type: "space"; id: string }`。

**注意：** 这会让 TaskSidebar 内部使用 `selected.type === "space"` / `"inbox"` 的地方报错。临时把这些分支删掉（保留 all/trash/space→临时用 list 占位的渲染）。实际上 Task 6 会重写整个 TaskSidebar，本任务只需让它编译通过。把 Row 的 active 判断改为：`selected.type === "list" && selected.id === space.id`（临时用 list 类型复用旧 space 渲染），或更安全：本任务把 TaskSidebar 的 space 列表渲染临时保留但 onSelect 传 `{ type: "list", id: space.id }`。

- [ ] **Step 6: typecheck**

```bash
pnpm typecheck
```

预期：无错误。若有遗漏的 spaceId 引用，逐一改为 listId。

- [ ] **Step 7: 运行测试**

```bash
pnpm test
```

预期：既有测试若引用 spaceId 需同步改 listId。

- [ ] **Step 8: Commit**

```bash
git add src/components/tasks/types.ts src/components/tasks/use-tasks.ts src/components/tasks/TaskPanel.tsx src/components/tasks/TaskSidebar.tsx src/app/tasks/page.tsx
git commit -m "$(cat <<'EOF'
feat(tasks): 前端类型切换 spaceId→listId/folderId，SelectedKey 加 folder/list

TaskSidebar 渲染将在 Task 6 重写。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 前端切换 part 2（QuickAddDialog 清单选择器 + TrashView + TaskSidebar 重写渲染）

**Files:**
- Modify: `src/components/tasks/QuickAddDialog.tsx`
- Modify: `src/components/tasks/TrashView.tsx`
- Modify: `src/components/tasks/TaskSidebar.tsx`（重写：树渲染 + counts + expand/collapse，无 CRUD/DnD）

- [ ] **Step 1: QuickAddDialog 加清单选择器（必填）**

`QuickAddDialogProps.onAdd` data 类型加 `listId: string`。

新增 props `defaultListId?: string` 和 `lists` 数据来源：组件内 `useEffect` fetch `/api/tasks/folders` 拿全树，展平成 `{ id, name, color, folderName? }[]`。

新增 state `const [listId, setListId] = useState<string>("")`。

`useEffect` open 时：`if (open) { setListId(defaultListId ?? firstListId ?? "") }`。

toolbar 中加一个清单下拉（select），必填；若 listId 为空则禁用提交按钮。

`handleSubmit` 传 `listId`。

`tasks/page.tsx` 中 `<QuickAddDialog>` 传 `defaultListId={selected.type === "list" ? selected.id : undefined}`。

- [ ] **Step 2: TrashView 把 task.space 改为 task.list**

`src/components/tasks/TrashView.tsx` 第 48-50 行：
```tsx
{task.space && (
  <span className="text-xs text-muted-foreground shrink-0">📁 {task.space.name}</span>
)}
```
改为：
```tsx
{task.list && (
  <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: task.list.color }} />
    {task.list.name}
  </span>
)}
```

- [ ] **Step 3: 重写 TaskSidebar（树渲染 + counts + expand/collapse）**

完整替换 `src/components/tasks/TaskSidebar.tsx`：

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { ListChecks, FolderOpen, FolderClosed, ChevronRight, ChevronDown, Trash2, Tag as TagIcon, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TagManageDialog } from "./TagManageDialog";
import { TaskFolderDialog } from "./TaskFolderDialog";
import { TaskListDialog } from "./TaskListDialog";

export type SelectedKey =
  | { type: "all" }
  | { type: "folder"; id: string }
  | { type: "list"; id: string }
  | { type: "trash" };

interface TaskListInfo {
  id: string;
  name: string;
  color: string;
  folderId: string | null;
}
interface TaskFolderInfo {
  id: string;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  lists: TaskListInfo[];
}

type Counts = {
  total: number;
  byList: Record<string, number>;
  trashed: number;
};

interface TaskSidebarProps {
  selected: SelectedKey;
  onSelect: (key: SelectedKey) => void;
  refreshKey?: number;
}

export function TaskSidebar({ selected, onSelect, refreshKey }: TaskSidebarProps) {
  const [folders, setFolders] = useState<TaskFolderInfo[]>([]);
  const [standaloneLists, setStandaloneLists] = useState<TaskListInfo[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, byList: {}, trashed: 0 });
  const [tagOpen, setTagOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [listDialogFolderId, setListDialogFolderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [treeRes, countRes] = await Promise.all([
      fetch("/api/tasks/folders"),
      fetch("/api/tasks/counts"),
    ]);
    if (treeRes.ok) {
      const data = await treeRes.json();
      setFolders(data.folders ?? []);
      setStandaloneLists(data.standaloneLists ?? []);
    }
    if (countRes.ok) {
      const c = await countRes.json();
      setCounts({ total: c.total, byList: c.byList ?? {}, trashed: c.trashed });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const toggleCollapsed = async (folder: TaskFolderInfo) => {
    // 乐观更新
    setFolders((fs) =>
      fs.map((f) => (f.id === folder.id ? { ...f, collapsed: !f.collapsed } : f))
    );
    await fetch(`/api/tasks/folders/${folder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collapsed: !folder.collapsed }),
    });
  };

  const folderTaskCount = (f: TaskFolderInfo) =>
    f.lists.reduce((sum, l) => sum + (counts.byList[l.id] ?? 0), 0);

  const openListDialog = (folderId: string | null) => {
    setListDialogFolderId(folderId);
    setListDialogOpen(true);
  };

  return (
    <aside className="w-60 shrink-0 border-r border-border flex flex-col gap-1 p-3 h-full">
      <button
        onClick={() => onSelect({ type: "all" })}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
          selected.type === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <ListChecks className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">全部任务</span>
        {counts.total > 0 && <span className="text-xs shrink-0">{counts.total}</span>}
      </button>

      <div className="h-px bg-border my-1" />

      <div className="flex items-center justify-between px-2">
        <span className="text-xs text-muted-foreground">清单</span>
        <div className="flex items-center gap-1">
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

      {/* 顶层独立清单 */}
      {standaloneLists.map((list) => (
        <button
          key={list.id}
          onClick={() => onSelect({ type: "list", id: list.id })}
          className={cn(
            "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
            selected.type === "list" && selected.id === list.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: list.color }} />
          <span className="flex-1 text-left truncate">{list.name}</span>
          {(counts.byList[list.id] ?? 0) > 0 && (
            <span className="text-xs shrink-0">{counts.byList[list.id]}</span>
          )}
        </button>
      ))}

      {/* 文件夹 */}
      {folders.map((folder) => (
        <div key={folder.id} className="space-y-0.5">
          <div
            className={cn(
              "group flex items-center gap-1 w-full px-1 py-1 rounded-md text-sm transition-colors",
              selected.type === "folder" && selected.id === folder.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <button
              onClick={() => toggleCollapsed(folder)}
              className="p-0.5 rounded hover:bg-accent"
              title={folder.collapsed ? "展开" : "收起"}
            >
              {folder.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {folder.collapsed ? <FolderClosed className="h-4 w-4 shrink-0" /> : <FolderOpen className="h-4 w-4 shrink-0" />}
            <button
              onClick={() => onSelect({ type: "folder", id: folder.id })}
              className="flex-1 text-left truncate"
            >
              {folder.name}
            </button>
            {folderTaskCount(folder) > 0 && (
              <span className="text-xs shrink-0">{folderTaskCount(folder)}</span>
            )}
            <button
              onClick={() => openListDialog(folder.id)}
              className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"
              title="往此文件夹加清单"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {!folder.collapsed &&
            folder.lists.map((list) => (
              <button
                key={list.id}
                onClick={() => onSelect({ type: "list", id: list.id })}
                className={cn(
                  "flex items-center gap-2 w-full pl-8 pr-2 py-1.5 rounded-md text-sm transition-colors",
                  selected.type === "list" && selected.id === list.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: list.color }} />
                <span className="flex-1 text-left truncate">{list.name}</span>
                {(counts.byList[list.id] ?? 0) > 0 && (
                  <span className="text-xs shrink-0">{counts.byList[list.id]}</span>
                )}
              </button>
            ))}
        </div>
      ))}

      <div className="h-px bg-border my-1" />

      <button
        onClick={() => onSelect({ type: "trash" })}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
          selected.type === "trash" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <Trash2 className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">垃圾箱</span>
        {counts.trashed > 0 && <span className="text-xs shrink-0">{counts.trashed}</span>}
      </button>

      <div className="flex-1" />

      <button
        onClick={() => setTagOpen(true)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <TagIcon className="h-4 w-4 shrink-0" />
        标签管理
      </button>

      <TagManageDialog open={tagOpen} onOpenChange={setTagOpen} />
      <TaskFolderDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        onSaved={load}
      />
      <TaskListDialog
        open={listDialogOpen}
        onOpenChange={setListDialogOpen}
        folderId={listDialogFolderId}
        onSaved={load}
      />
    </aside>
  );
}
```

**注意：** 此处引用了 `TaskFolderDialog` 与 `TaskListDialog`（Task 7 创建）。为让本任务 typecheck 绿，本任务同步创建这两个 dialog 的最小版本（仅新建功能）。把这两个 dialog 的完整实现放 Task 7，本任务先建 stub：

实际上为避免重复，把 TaskFolderDialog + TaskListDialog 完整实现并入本任务 Step 4。

- [ ] **Step 4: 创建 TaskFolderDialog.tsx + TaskListDialog.tsx**

`src/components/tasks/TaskFolderDialog.tsx`：

```tsx
"use client";

import { useState, useEffect } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface TaskFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  // 编辑模式（可选）
  folder?: { id: string; name: string } | null;
}

export function TaskFolderDialog({ open, onOpenChange, onSaved, folder }: TaskFolderDialogProps) {
  const [name, setName] = useState("");
  const { confirm: confirmDialog, dialog: confirmElement } = useConfirm();

  useEffect(() => {
    if (open) setName(folder?.name ?? "");
  }, [open, folder]);

  if (!open) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    if (folder) {
      await fetch(`/api/tasks/folders/${folder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
    } else {
      await fetch("/api/tasks/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
    }
    onSaved();
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!folder) return;
    const ok = await confirmDialog({
      title: "删除文件夹",
      description: `「${folder.name}」将被删除，其下清单提升为顶层独立清单。`,
    });
    if (!ok) return;
    await fetch(`/api/tasks/folders/${folder.id}`, { method: "DELETE" });
    onSaved();
    onOpenChange(false);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-50" onClick={() => onOpenChange(false)} />
      <div className="fixed top-1/3 left-1/2 -translate-x-1/2 z-50 w-80 bg-background border border-border rounded-xl shadow-2xl p-4">
        <h3 className="font-medium mb-3">{folder ? "重命名文件夹" : "新建文件夹"}</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          placeholder="文件夹名称"
          className="w-full px-3 py-2 bg-muted rounded-md text-sm outline-none"
        />
        <div className="flex justify-between mt-4">
          {folder ? (
            <button onClick={handleDelete} className="text-xs text-red-500 hover:underline">删除</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={() => onOpenChange(false)} className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded-md">取消</button>
            <button onClick={handleSave} disabled={!name.trim()} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50">保存</button>
          </div>
        </div>
      </div>
      {confirmElement}
    </>
  );
}
```

`src/components/tasks/TaskListDialog.tsx`：

```tsx
"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  "#6b7280", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899",
] as const;

interface TaskListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId?: string | null;
  folders?: { id: string; name: string }[];
  onSaved: () => void;
  // 编辑模式（可选）
  list?: { id: string; name: string; color: string; folderId: string | null } | null;
}

export function TaskListDialog({ open, onOpenChange, folderId, folders = [], onSaved, list }: TaskListDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PRESET_COLORS[0]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(list?.name ?? "");
      setColor(list?.color ?? PRESET_COLORS[0]);
      setSelectedFolderId(list?.folderId ?? folderId ?? null);
    }
  }, [open, list, folderId]);

  if (!open) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    if (list) {
      await fetch(`/api/tasks/lists/${list.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color, folderId: selectedFolderId }),
      });
    } else {
      await fetch("/api/tasks/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color, folderId: selectedFolderId }),
      });
    }
    onSaved();
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!list) return;
    if (!confirm(`删除「${list.name}」？其下任务将移入垃圾箱。`)) return;
    await fetch(`/api/tasks/lists/${list.id}`, { method: "DELETE" });
    onSaved();
    onOpenChange(false);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-50" onClick={() => onOpenChange(false)} />
      <div className="fixed top-1/3 left-1/2 -translate-x-1/2 z-50 w-96 bg-background border border-border rounded-xl shadow-2xl p-4">
        <h3 className="font-medium mb-3">{list ? "编辑清单" : "新建清单"}</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          placeholder="清单名称"
          className="w-full px-3 py-2 bg-muted rounded-md text-sm outline-none mb-3"
        />
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1.5">颜色</p>
          <div className="flex gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={cn("w-6 h-6 rounded-full transition-transform", color === c && "ring-2 ring-offset-2 ring-primary scale-110")}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        {folders.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-muted-foreground mb-1.5">所属文件夹</p>
            <select
              value={selectedFolderId ?? ""}
              onChange={(e) => setSelectedFolderId(e.target.value || null)}
              className="w-full px-3 py-2 bg-muted rounded-md text-sm outline-none"
            >
              <option value="">（顶层独立清单）</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-between mt-4">
          {list ? (
            <button onClick={handleDelete} className="text-xs text-red-500 hover:underline">删除清单</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={() => onOpenChange(false)} className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded-md">取消</button>
            <button onClick={handleSave} disabled={!name.trim()} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50">保存</button>
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 5: typecheck + test**

```bash
pnpm typecheck
pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add src/components/tasks/QuickAddDialog.tsx src/components/tasks/TrashView.tsx src/components/tasks/TaskSidebar.tsx src/components/tasks/TaskFolderDialog.tsx src/components/tasks/TaskListDialog.tsx src/app/tasks/page.tsx
git commit -m "$(cat <<'EOF'
feat(tasks): TaskSidebar 树渲染 + 清单选择器 + TrashView list 标签

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: TaskSidebar 行内 ⋯ 菜单（重命名/改色/移动/删除）

**Files:**
- Modify: `src/components/tasks/TaskSidebar.tsx`

**目标：** 清单行与文件夹行 hover 出 ⋯ 菜单，打开编辑 Dialog。

- [ ] **Step 1: 给 TaskSidebar 加编辑态 state 与 ⋯ 按钮**

在 TaskSidebar 组件内新增：
```ts
const [editFolder, setEditFolder] = useState<TaskFolderInfo | null>(null);
const [editList, setEditList] = useState<TaskListInfo | null>(null);
```

文件夹行的 `group` div 内，在「+ 加清单」按钮旁，新增 ⋯ 按钮：
```tsx
<button
  onClick={() => setEditFolder(folder)}
  className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"
  title="编辑文件夹"
>
  <MoreHorizontal className="h-3.5 w-3.5" />
</button>
```
（`MoreHorizontal` 从 lucide-react import）

清单行（顶层独立 + 文件夹内两类）也加 hover ⋯ 按钮 → `setEditFolder(null); setEditList(list)`。

把底部的 TaskFolderDialog/TaskListDialog 实例改为支持编辑模式：
```tsx
<TaskFolderDialog
  open={folderDialogOpen || editFolder !== null}
  onOpenChange={(o) => { if (!o) { setFolderDialogOpen(false); setEditFolder(null); } }}
  onSaved={load}
  folder={editFolder}
/>
<TaskListDialog
  open={listDialogOpen || editList !== null}
  onOpenChange={(o) => { if (!o) { setListDialogOpen(false); setEditList(null); } }}
  folderId={listDialogFolderId}
  folders={folders.map(f => ({ id: f.id, name: f.name }))}
  onSaved={load}
  list={editList}
/>
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/tasks/TaskSidebar.tsx
git commit -m "$(cat <<'EOF'
feat(tasks): TaskSidebar 行内 ⋯ 菜单（重命名/改色/移动/删除）

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: TaskSidebar 拖拽排序（folder + list，含跨父级移动）

**Files:**
- Modify: `src/components/tasks/TaskSidebar.tsx`

**目标：** 用 @dnd-kit 实现文件夹间排序 + 清单间排序（同父级 + 跨父级移动）。

- [ ] **Step 1: 实现 DnD**

参考 `src/components/tasks/KanbanView.tsx` 现有 @dnd-kit 用法（先 graphify query 或读该文件）。

在 TaskSidebar 内引入 `DndContext` + `SortableContext` + `useSortable`。两个独立 sortable 上下文：

1. **文件夹级**：把 folders 数组用 `SortableContext` 包裹；onDragEnd 时算新 sortOrder 数组，乐观更新 state + `POST /api/tasks/folders/reorder`。
2. **清单级**：整体清单排序较复杂（跨顶层/文件夹）。简化做法：对「顶层独立清单」与「每个文件夹内的清单」各开一个 SortableContext（同父级内排序）；跨父级拖动通过清单行的 droppable folder 区域实现（拖到文件夹名上松手 → 该清单 folderId 变更）。**若跨父级拖动实现复杂度过高，本任务只做同父级内排序，跨父级用 TaskListDialog 的「移动到文件夹」下拉兜底**。

实施时遵循 YAGNI：先做同父级内排序（覆盖用户主要诉求「文件夹拖动 + 文件夹内清单拖动」），跨父级用 dialog 兜底。onDragEnd 乐观更新后 `POST /api/tasks/lists/reorder { items: [{id, sortOrder}] }`。

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/tasks/TaskSidebar.tsx
git commit -m "$(cat <<'EOF'
feat(tasks): TaskSidebar 拖拽排序（文件夹 + 同父级清单）

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 后端移除 legacy spaceId + Migration B + smart-views 去 inbox

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260717000000_task_drop_spaceid/migration.sql`
- Modify: `src/app/api/tasks/route.ts`
- Modify: `src/app/api/tasks/[id]/route.ts`
- Modify: `src/app/api/tasks/counts/route.ts`
- Modify: `src/lib/tasks/smart-views.ts`
- Modify: `src/components/tasks/TaskPanel.tsx`（移除 SmartView 类型中 inbox 引用，如果还有）

- [ ] **Step 1: 修改 prisma/schema.prisma**

`model Task` 中：
- 删除 `spaceId String? // 关联空间`
- 删除 `space Space? @relation(fields: [spaceId], references: [id])`
- 删除 `@@index([spaceId, status, sortOrder])`
- 把 `listId String?` 改为 `listId String`
- `model Space` 中删除 `tasks Task[]` 这一行关系

- [ ] **Step 2: 创建 Migration B**

`prisma/migrations/20260717000000_task_drop_spaceid/migration.sql`：

```sql
-- 回填 listId（保险：若有遗漏的 null，指向默认清单）
UPDATE "Task" SET "listId" = 'cl_default_list_seed_fixed' WHERE "listId" IS NULL;

-- 用 new_Task recreate：移除 spaceId，listId NOT NULL + FK RESTRICT
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dueDate" DATETIME,
    "dueTime" TEXT,
    "isAllDay" BOOLEAN NOT NULL DEFAULT true,
    "completedAt" DATETIME,
    "parentId" TEXT,
    "listId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "isCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "trashed" BOOLEAN NOT NULL DEFAULT false,
    "trashedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TaskList" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("completedAt", "content", "createdAt", "dueDate", "dueTime", "id", "isAllDay", "isCollapsed", "listId", "parentId", "priority", "sortOrder", "status", "tagsJson", "title", "trashed", "trashedAt", "expiresAt", "updatedAt")
SELECT "completedAt", "content", "createdAt", "dueDate", "dueTime", "id", "isAllDay", "isCollapsed", "listId", "parentId", "priority", "sortOrder", "status", "tagsJson", "title", "trashed", "trashedAt", "expiresAt", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_listId_status_sortOrder_idx" ON "Task"("listId", "status", "sortOrder");
CREATE INDEX "Task_status_dueDate_idx" ON "Task"("status", "dueDate");
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");
CREATE INDEX "Task_priority_status_idx" ON "Task"("priority", "status");
CREATE INDEX "Task_trashed_idx" ON "Task"("trashed");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
```

- [ ] **Step 3: 应用 migration + 重新生成**

```bash
DATABASE_URL="file:./dev.db" pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

- [ ] **Step 4: 移除 tasks API 的 spaceId 残留**

`src/app/api/tasks/route.ts`：`createSchema` 删 `spaceId`；GET handler 删 `spaceId` 读取与 where 分支；POST data 删 `spaceId`。`include` 删 `space: {...}`。

`src/app/api/tasks/[id]/route.ts`：`updateSchema` 删 `spaceId`；PATCH 解构与 data 赋值删 spaceId。

`src/app/api/tasks/counts/route.ts`：删 bySpaceActive 那段与 bySpace/inbox 字段，返回 `{ total, byList, trashed }`。

- [ ] **Step 5: smart-views 去 inbox**

`src/lib/tasks/smart-views.ts`：
- `export type SmartView = "today" | "next7days" | "inbox"` → `"today" | "next7days"`
- 删 `isInbox` 函数
- `filterBySmartView` 删 `case "inbox":`

`src/app/api/tasks/route.ts`：删 `smartViewRaw === ... || ... === "inbox"` 的 inbox 分支。

`src/components/tasks/TaskPanel.tsx`：SmartView import 类型自动缩窄，确认分段控件已无 inbox（Task 5 已做）。

- [ ] **Step 6: 全量 typecheck + test**

```bash
pnpm typecheck
pnpm test
```

预期：无错误。修掉任何 spaceId 残留引用。

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260717000000_task_drop_spaceid src/app/api/tasks src/lib/tasks/smart-views.ts src/components/tasks/TaskPanel.tsx
git commit -m "$(cat <<'EOF'
feat(tasks): 移除 Task.spaceId + smart-views inbox，listId 必填

Migration B：new_Task recreate，listId NOT NULL + FK RESTRICT。
Task 从 Space 完全解耦。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 全量测试 + graphify update + 收尾

**Files:**
- 全局扫描 spaceId 残留

- [ ] **Step 1: 全局搜索 spaceId 残留**

```bash
graphify query "还有哪些地方引用 Task.spaceId 或 smartView inbox？" 2>&1 | head -40
```

用 Grep 工具确认：
- 搜 `spaceId`（在 src/ 与 tests/ 下）
- 搜 `smartView.*inbox` / `"inbox"`
- 搜 `task.space`（非 trashed）

逐一修复残留。

- [ ] **Step 2: 运行完整测试套件**

```bash
pnpm test
```

预期：全部通过（含 claude-session-store 的 migration runner 测试，确认新 migration 排序正确）。

- [ ] **Step 3: typecheck 最终确认**

```bash
pnpm typecheck
```

- [ ] **Step 4: graphify 更新**

```bash
graphify update .
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(tasks): 收尾——清理 spaceId 残留 + graphify 更新

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## 完成后

使用 superpowers:finishing-a-development-branch 收尾（合并 / PR / 清理）。
