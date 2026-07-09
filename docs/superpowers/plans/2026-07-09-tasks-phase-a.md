# Tasks Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all low-risk, non-destructive improvements to the Tasks module from the reconciliation doc §6 阶段 A — schema field additions, smart views, GlobalSearch integration, shortcut fix, and design doc revision.

**Architecture:** Each sub-item is independent and ships its own commit. Schema changes use additive-only migrations (new fields are nullable / have defaults; index changes are drop+recreate). New UI behaviors reuse existing patterns (smart views follow the existing `useTasks` hook + `TaskPanel` shell; GlobalSearch follows the existing snippets source pattern with a pure `taskToSearchResultItem` function).

**Tech Stack:** Next.js 16 / React 19 / Prisma + SQLite / vitest / TypeScript

## Global Constraints

- **No destructive data changes**: every schema migration must be reversible and must preserve existing rows.
- **Migration filename format**: `YYYYMMDDHHMMSS_<snake_case_name>` (matches existing `20260713000000_task_management`). Use timestamp `20260714000000` for the new migration.
- **Test runner**: vitest. Pure functions live in `src/lib/tasks/` and have unit tests in `tests/unit/`.
- **Type sourcing of truth**: `src/components/tasks/types.ts` is the runtime type authority. `STATUS_CONFIG` and `PRIORITY_CONFIG` must stay in sync with usage in `TaskItem.tsx`.
- **Commits**: every task ends with `git add <explicit paths> && git commit -m "<conventional message>"`. Never `git add -A`.
- **Search result contract**: every source returns items shaped `{ id: string; title: string; subtitle?: string; href: string }` (see `src/app/api/search/route.ts:9-14`).
- **No new dependencies**: Phase A uses only what's already installed.
- **Keep `tagsJson` and `spaceId` untouched**: those belong to Phase B/C, not A.

---

## File Structure

**New files (5):**

| Path | Responsibility |
|---|---|
| `prisma/migrations/20260714000000_task_phase_a_fields_indexes/migration.sql` | Add `isAllDay`, `dueTime` columns; rebuild indexes as composite |
| `src/lib/tasks/smart-views.ts` | Pure date predicates: `isToday(task)`, `isNext7Days(task)`, `isInbox(task)` |
| `src/lib/tasks/search-result.ts` | Pure function `taskToSearchResultItem(task)` mapping Task → search result |
| `tests/unit/task-smart-views.test.ts` | vitest tests for smart-views predicates |
| `tests/unit/task-search-result.test.ts` | vitest tests for task→search-result mapping |

**Modified files (10):**

| Path | Change |
|---|---|
| `prisma/schema.prisma` | Add `isAllDay Boolean @default(true)` and `dueTime String?`; replace 6 single-column indexes with 4 composite indexes |
| `src/components/tasks/types.ts` | Add `"cancelled"` to `TaskStatus`; add `isAllDay`/`dueTime` to `Task` interface; add `STATUS_CONFIG.cancelled` entry |
| `src/components/tasks/TaskItem.tsx` | Render cancelled state (strikethrough + grey) consistently with `done` |
| `src/components/tasks/use-tasks.ts` | Accept optional `smartView?: "today" \| "next7days" \| "inbox"` filter param |
| `src/components/tasks/TaskPanel.tsx` | Render segmented control for smart views above the list |
| `src/app/tasks/page.tsx` | Change `Cmd+N` to `Cmd+Shift+T`; update kbd hint |
| `src/app/api/tasks/route.ts` | Accept `smartView` query param; apply predicate filter |
| `src/app/api/search/route.ts` | Add `tasks: SearchResultItem[]` to type + query + mapping |
| `src/components/common/GlobalSearch.tsx` | Add `tasks: ResultItem[]` to type + render section |
| `docs/task-list-design.md` | Revise §1.1 (sidebar → header), §2.1 (status enum + priority Int) |

---

## Task Order

Tasks are sequenced for early value and low merge conflict risk. Dependencies:

```
T1 (docs revision) ──┐
T2 (shortcut fix)  ──┼── independent, ship first
                     │
T3 (schema) ──────┐  │
                  ├──┴── T4 (types) ── T5 (smart-view lib) ── T6 (smart-view API) ── T7 (smart-view UI)
T8 (search-result lib) ── T9 (search-result wiring)
```

- T1, T2, T3, T8 have no prerequisites and can be picked in any order.
- T4 requires T3 (uses new fields).
- T5–T7 require T4.
- T9 requires T8.

---

## Task 1: Revise design doc to match reality

**Files:**
- Modify: `docs/task-list-design.md` (§0, §1.1, §2.1)

**Interfaces:** none — documentation only.

**Why first:** Zero risk, establishes the spec we're aligning code to, prevents later confusion in T4 where status enum decisions live.

- [ ] **Step 1: Update §1.1 entry point description**

Open `docs/task-list-design.md`. Find the §1.1 block that describes "左侧导航栏" between 「我的文章」and「素材库」. Replace the entire §1.1 section with:

```markdown
### 1.1 顶部导航栏入口

InkPress 使用顶部 header 导航（无左侧 sidebar）。在顶部导航条中，于「首页」和「素材」之间新增一级入口：

\`\`\`
┌─────────────────────────────────────────────────────────┐
│ [Logo]  首页  任务  素材  灵感  ...    🔍 搜索  🌙 ⚙️   │
└─────────────────────────────────────────────────────────┘
\`\`\`

- 图标：Lucide \`CheckSquare\`
- 文案：「任务」
- 跳转 \`/tasks\` 路由
- 当前实现：\`src/app/page.tsx:97-99\` 顶部 header 已有该入口
```

- [ ] **Step 2: Update §2.1 Task model block**

Find the `model Task { ... }` block in §2.1. Replace the `status` and `priority` lines to match code reality (lowercase status values, Int priority):

```prisma
model Task {
  // ... other fields unchanged ...
  status        String   @default("todo") // todo | in_progress | done | cancelled | archived
  priority      Int      @default(0) // 0=none, 1=low, 2=medium, 3=high, 4=urgent
  // ...
}
```

Add a footnote immediately after the schema block:

```markdown
> **实现说明（2026-07-09 修订）**：与早期设计稿相比，做了两处类型决策：
> 1. **status 用小写**：与 SQLite 字符串习惯一致，避免大小写转换。补充 \`cancelled\` 表达"主动放弃"语义，与 \`archived\`（"事后归档"）区分。
> 2. **priority 用 Int**：天然支持 \`ORDER BY priority DESC\` 排序，无需应用层枚举顺序映射。可读性通过 \`PRIORITY_CONFIG\` 表（\`src/components/tasks/types.ts\`）补回。
> 详见 \`docs/superpowers/specs/2026-07-09-tasks-reconciliation-design.md\` ADR-7 / ADR-8。
```

- [ ] **Step 3: Verify no other "sidebar" / 左侧 references remain**

Run: `grep -n "sidebar\|左侧导航\|左侧 sidebar" docs/task-list-design.md`
Expected: no matches (or only matches inside code-fence examples that don't refer to app navigation).

- [ ] **Step 4: Commit**

```bash
git add docs/task-list-design.md
git commit -m "docs(tasks): 修订设计文档对齐现状（sidebar→header / status 小写 / priority Int）"
```

---

## Task 2: Change quick-add shortcut from Cmd+N to Cmd+Shift+T

**Files:**
- Modify: `src/app/tasks/page.tsx:15-29` (keydown handler) and `src/app/tasks/page.tsx:68` (kbd hint)

**Interfaces:** none — UI-only change.

- [ ] **Step 1: Update the keydown handler**

In `src/app/tasks/page.tsx`, find the `useEffect` block around line 16-29 with the signature `(e.metaKey || e.ctrlKey) && e.key === "n"`. Replace the condition with:

```tsx
if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "t" || e.key === "T")) {
  e.preventDefault();
  setQuickAddOpen(true);
}
```

Note: check both lowercase and uppercase `t` because Shift modifies the key name on some keyboard layouts.

- [ ] **Step 2: Update the kbd hint text**

Find line 68 with `<kbd className="ml-1 text-[10px] opacity-60 hidden sm:inline">⌘N</kbd>`. Replace with:

```tsx
<kbd className="ml-1 text-[10px] opacity-60 hidden sm:inline">⌘⇧T</kbd>
```

- [ ] **Step 3: Verify manually**

Run: `pnpm dev` (in background), open `http://localhost:3000/tasks`, press `Cmd+Shift+T`. Expected: QuickAdd dialog opens. Press `Cmd+N` — expected: nothing happens (or browser default, but no dialog).

- [ ] **Step 4: Commit**

```bash
git add src/app/tasks/page.tsx
git commit -m "fix(tasks): 快捷键 Cmd+N → Cmd+Shift+T 对齐设计文档"
```

---

## Task 3: Schema migration — add isAllDay/dueTime, rebuild indexes as composite

**Files:**
- Modify: `prisma/schema.prisma` (Task model, ~line 601 onwards)
- Create: `prisma/migrations/20260714000000_task_phase_a_fields_indexes/migration.sql`

**Interfaces:**
- Produces: `Task.isAllDay: Boolean` (default `true`) and `Task.dueTime: String | null` for downstream tasks.

- [ ] **Step 1: Edit `prisma/schema.prisma` Task model**

Find the Task model. Make three edits:

(a) Add the two new fields immediately after `dueDate`:

```prisma
  dueDate     DateTime?
  dueTime     String?   // "HH:mm"（可选精确到分钟）；为空表示全天任务
  isAllDay    Boolean   @default(true)
  completedAt DateTime?
```

(b) Replace the existing index block:

```prisma
  @@index([parentId])
  @@index([spaceId])
  @@index([status])
  @@index([priority])
  @@index([dueDate])
  @@index([sortOrder])
```

with the composite indexes (matches reconciliation doc ADR-6):

```prisma
  // 复合索引：精准命中"按清单/状态分组 + 排序显示"主查询路径
  @@index([spaceId, status, sortOrder])
  @@index([status, dueDate])
  @@index([parentId])
  @@index([priority, status])
```

- [ ] **Step 2: Create the migration SQL**

Create `prisma/migrations/20260714000000_task_phase_a_fields_indexes/migration.sql` with:

```sql
-- Add dueTime and isAllDay fields (additive, non-breaking)
ALTER TABLE "Task" ADD COLUMN "dueTime" TEXT;
ALTER TABLE "Task" ADD COLUMN "isAllDay" BOOLEAN NOT NULL DEFAULT true;

-- Drop old single-column indexes
DROP INDEX IF EXISTS "Task_spaceId_idx";
DROP INDEX IF EXISTS "Task_status_idx";
DROP INDEX IF EXISTS "Task_priority_idx";
DROP INDEX IF EXISTS "Task_dueDate_idx";
DROP INDEX IF EXISTS "Task_sortOrder_idx";
-- Note: Task_parentId_idx is kept (still used as single-column in new schema)

-- Create new composite indexes
CREATE INDEX "Task_spaceId_status_sortOrder_idx" ON "Task"("spaceId", "status", "sortOrder");
CREATE INDEX "Task_status_dueDate_idx" ON "Task"("status", "dueDate");
CREATE INDEX "Task_priority_status_idx" ON "Task"("priority", "status");
```

- [ ] **Step 3: Verify index names match Prisma's convention**

Prisma generates index names as `<Model>_<col1>_<col2>..._idx` by default. The `DROP INDEX` names in step 2 must match what the previous migration actually created. Verify by reading the prior migration:

Run: `cat prisma/migrations/20260713000000_task_management/migration.sql`
Expected: shows the original `CREATE INDEX` statements — confirm the names match what step 2 drops. If the original migration used different names (e.g. quoted differently), update the `DROP INDEX` lines to match.

- [ ] **Step 4: Apply the migration locally**

Run: `pnpm prisma migrate dev`
Expected output: migration `20260714000000_task_phase_a_fields_indexes` applied, no errors. Prisma client regenerated.

If you see "drift detected" or similar, STOP — the local DB may have manual changes. Ask the user before proceeding.

- [ ] **Step 5: Verify the app still boots**

Run: `pnpm dev` in background, open `http://localhost:3000/tasks`. Expected: page loads, existing tasks still visible. Create a new task — should work as before (defaults: `isAllDay=true`, `dueTime=null`).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260714000000_task_phase_a_fields_indexes/migration.sql
git commit -m "feat(tasks): 补 isAllDay/dueTime 字段 + 索引调整为复合索引"
```

---

## Task 4: Update TS types — add "cancelled" status and new fields

**Files:**
- Modify: `src/components/tasks/types.ts`
- Modify: `src/components/tasks/TaskItem.tsx` (cancelled state rendering)

**Interfaces:**
- Consumes: new schema fields `Task.isAllDay`, `Task.dueTime` from T3.
- Produces: updated `TaskStatus` union including `"cancelled"`; updated `Task` interface; `STATUS_CONFIG.cancelled` entry.

- [ ] **Step 1: Update `src/components/tasks/types.ts`**

Replace lines 1-35 with the expanded version:

```typescript
export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled" | "archived";
export type TaskPriority = 0 | 1 | 2 | 3 | 4;

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
  sortOrder: number;
  tagsJson: string;
  isCollapsed: boolean;
  createdAt: string;
  updatedAt: string;
  children?: Task[];
}

export const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; emoji: string }> = {
  0: { label: "无", color: "text-muted-foreground", emoji: "" },
  1: { label: "低", color: "text-blue-500", emoji: "🔵" },
  2: { label: "中", color: "text-yellow-500", emoji: "🟡" },
  3: { label: "高", color: "text-orange-500", emoji: "🟠" },
  4: { label: "紧急", color: "text-red-500", emoji: "🔴" },
};

export const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: "待办", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  in_progress: { label: "进行中", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  done: { label: "已完成", color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  cancelled: { label: "已取消", color: "bg-gray-100 text-gray-500 line-through dark:bg-gray-800" },
  archived: { label: "已归档", color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500" },
};

export type ViewMode = "list" | "kanban" | "calendar";
```

- [ ] **Step 2: Update `TaskItem.tsx` to render cancelled state**

Open `src/components/tasks/TaskItem.tsx`. Find where the `done` state applies strikethrough/grey (search for `status === "done"` or similar). Add `status === "cancelled"` to the same conditional rendering path. Example pattern:

```tsx
// Before:
const isCompleted = task.status === "done";
// After:
const isCompleted = task.status === "done" || task.status === "cancelled";
```

Locate any status dropdown / picker UI in TaskItem.tsx. Add `cancelled` as a selectable option (label "已取消", value `"cancelled"`), placed between `done` and `archived` in the dropdown order.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors. If errors appear in `use-tasks.ts` about missing fields, ignore for now (T5 will handle it); only fix errors that block compilation.

- [ ] **Step 4: Verify manually**

Run: `pnpm dev`, open `/tasks`. Create a task. Change its status to "已取消" via the dropdown. Expected: title shows strikethrough, badge shows grey "已取消".

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/types.ts src/components/tasks/TaskItem.tsx
git commit -m "feat(tasks): status 补 cancelled 枚举 + isAllDay/dueTime 字段类型"
```

---

## Task 5: Smart-views predicate library (pure functions, TDD)

**Files:**
- Create: `src/lib/tasks/smart-views.ts`
- Test: `tests/unit/task-smart-views.test.ts`

**Interfaces:**
- Consumes: `Task` interface from `src/components/tasks/types.ts`.
- Produces:
  - `type SmartView = "today" | "next7days" | "inbox"`
  - `isToday(task: Task, now: Date): boolean`
  - `isNext7Days(task: Task, now: Date): boolean`
  - `isInbox(task: Task): boolean`
  - `filterBySmartView(tasks: Task[], view: SmartView, now?: Date): Task[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/task-smart-views.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isToday, isNext7Days, isInbox, filterBySmartView } from "@/lib/tasks/smart-views";
import type { Task } from "@/components/tasks/types";

const NOW = new Date("2026-07-14T10:00:00.000Z"); // 2026-07-14 Tuesday

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "t1",
    title: "x",
    content: "",
    status: "todo",
    priority: 0,
    dueDate: null,
    dueTime: null,
    isAllDay: true,
    completedAt: null,
    parentId: null,
    spaceId: null,
    sortOrder: 0,
    tagsJson: "[]",
    isCollapsed: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isToday", () => {
  it("dueDate 落在今天 → true", () => {
    const t = makeTask({ dueDate: "2026-07-14T08:00:00.000Z" });
    expect(isToday(t, NOW)).toBe(true);
  });
  it("dueDate 是昨天 → false", () => {
    const t = makeTask({ dueDate: "2026-07-13T23:59:00.000Z" });
    expect(isToday(t, NOW)).toBe(false);
  });
  it("dueDate 是明天 → false", () => {
    const t = makeTask({ dueDate: "2026-07-15T00:00:00.000Z" });
    expect(isToday(t, NOW)).toBe(false);
  });
  it("dueDate 为空 → false", () => {
    expect(isToday(makeTask({}), NOW)).toBe(false);
  });
  it("status=done 但 completedAt 是今天 → true（今日已完成也归入今天视图）", () => {
    const t = makeTask({ status: "done", completedAt: "2026-07-14T09:00:00.000Z" });
    expect(isToday(t, NOW)).toBe(true);
  });
  it("status=cancelled → 永远 false（已取消不计入）", () => {
    const t = makeTask({ status: "cancelled", dueDate: "2026-07-14T08:00:00.000Z" });
    expect(isToday(t, NOW)).toBe(false);
  });
});

describe("isNext7Days", () => {
  it("dueDate 在 3 天后 → true", () => {
    const t = makeTask({ dueDate: "2026-07-17T12:00:00.000Z" });
    expect(isNext7Days(t, NOW)).toBe(true);
  });
  it("dueDate 是今天 → true（区间含起点）", () => {
    const t = makeTask({ dueDate: "2026-07-14T20:00:00.000Z" });
    expect(isNext7Days(t, NOW)).toBe(true);
  });
  it("dueDate 是今天+7 整 → true（区间含终点 7 天后 23:59）", () => {
    const t = makeTask({ dueDate: "2026-07-21T10:00:00.000Z" });
    expect(isNext7Days(t, NOW)).toBe(true);
  });
  it("dueDate 是今天+8 → false", () => {
    const t = makeTask({ dueDate: "2026-07-22T10:00:00.000Z" });
    expect(isNext7Days(t, NOW)).toBe(false);
  });
  it("dueDate 是昨天 → false（已过期不算未来 7 天）", () => {
    const t = makeTask({ dueDate: "2026-07-13T10:00:00.000Z" });
    expect(isNext7Days(t, NOW)).toBe(false);
  });
  it("status=cancelled → false", () => {
    const t = makeTask({ status: "cancelled", dueDate: "2026-07-17T12:00:00.000Z" });
    expect(isNext7Days(t, NOW)).toBe(false);
  });
});

describe("isInbox", () => {
  it("spaceId=null 且未完成 → true", () => {
    expect(isInbox(makeTask({ spaceId: null, status: "todo" }))).toBe(true);
  });
  it("spaceId 有值 → false", () => {
    expect(isInbox(makeTask({ spaceId: "s1", status: "todo" }))).toBe(false);
  });
  it("status=done → false（已完成不进收集箱）", () => {
    expect(isInbox(makeTask({ spaceId: null, status: "done" }))).toBe(false);
  });
  it("status=archived → false", () => {
    expect(isInbox(makeTask({ spaceId: null, status: "archived" }))).toBe(false);
  });
  it("status=cancelled → false", () => {
    expect(isInbox(makeTask({ spaceId: null, status: "cancelled" }))).toBe(false);
  });
});

describe("filterBySmartView", () => {
  const tasks: Task[] = [
    makeTask({ id: "a", dueDate: "2026-07-14T08:00:00.000Z" }), // today
    makeTask({ id: "b", dueDate: "2026-07-17T08:00:00.000Z" }), // next7
    makeTask({ id: "c", spaceId: "s1" }), // neither inbox (has space)
    makeTask({ id: "d", spaceId: null, status: "todo" }), // inbox
    makeTask({ id: "e", status: "cancelled", dueDate: "2026-07-14T08:00:00.000Z" }), // cancelled
  ];

  it("today → 只留 a", () => {
    const r = filterBySmartView(tasks, "today", NOW);
    expect(r.map((t) => t.id)).toEqual(["a"]);
  });
  it("next7days → 留 a 和 b", () => {
    const r = filterBySmartView(tasks, "next7days", NOW);
    expect(r.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });
  it("inbox → 只留 d", () => {
    const r = filterBySmartView(tasks, "inbox", NOW);
    expect(r.map((t) => t.id)).toEqual(["d"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/unit/task-smart-views.test.ts`
Expected: FAIL with error like "Failed to resolve import @/lib/tasks/smart-views".

- [ ] **Step 3: Implement `src/lib/tasks/smart-views.ts`**

```typescript
import type { Task } from "@/components/tasks/types";

export type SmartView = "today" | "next7days" | "inbox";

/** 是否为"已结束"的终态：done / cancelled / archived 都不再进入活动视图。 */
function isTerminalStatus(task: Task): boolean {
  return task.status === "done" || task.status === "cancelled" || task.status === "archived";
}

/** 取某日历天的 [start, end) 时间区间（UTC）。 */
function dayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** 任务是否属于"今天"视图：dueDate 落在今天 OR（已完成且 completedAt 落在今天）。 */
export function isToday(task: Task, now: Date): boolean {
  if (task.status === "cancelled") return false;
  const { start, end } = dayRange(now);
  if (task.status === "done" && task.completedAt) {
    const c = new Date(task.completedAt);
    return c >= start && c < end;
  }
  if (task.dueDate) {
    const d = new Date(task.dueDate);
    return d >= start && d < end;
  }
  return false;
}

/** 任务是否属于"最近 7 天"视图：dueDate 落在 [今天, 今天+7天) 区间。 */
export function isNext7Days(task: Task, now: Date): boolean {
  if (task.status === "cancelled") return false;
  if (!task.dueDate) return false;
  const { start } = dayRange(now);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const d = new Date(task.dueDate);
  return d >= start && d < end;
}

/** 任务是否属于"收集箱"：无 spaceId 且未结束。 */
export function isInbox(task: Task): boolean {
  if (isTerminalStatus(task)) return false;
  return task.spaceId === null;
}

/** 按智能视图批量过滤。now 默认 new Date()。 */
export function filterBySmartView(tasks: Task[], view: SmartView, now: Date = new Date()): Task[] {
  switch (view) {
    case "today":
      return tasks.filter((t) => isToday(t, now));
    case "next7days":
      return tasks.filter((t) => isNext7Days(t, now));
    case "inbox":
      return tasks.filter((t) => isInbox(t));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/task-smart-views.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/smart-views.ts tests/unit/task-smart-views.test.ts
git commit -m "feat(tasks): 智能视图谓词库（today/next7days/inbox）"
```

---

## Task 6: Smart-view API filter

**Files:**
- Modify: `src/app/api/tasks/route.ts`
- Modify: `src/components/tasks/use-tasks.ts`

**Interfaces:**
- Consumes: `SmartView` type and `filterBySmartView` from T5.
- Produces: GET `/api/tasks?smartView=today|next7days|inbox` returns filtered tasks; `useTasks({ smartView })` hook API.

- [ ] **Step 1: Update the API route to accept `smartView` query param**

Open `src/app/api/tasks/route.ts`. Find the existing `GET` handler. After the existing query parameters parsing (around line 30-40), add:

```typescript
import { filterBySmartView, type SmartView } from "@/lib/tasks/smart-views";

// Inside GET handler, after existing params parsed:
const smartViewRaw = url.searchParams.get("smartView");
const smartView: SmartView | null =
  smartViewRaw === "today" || smartViewRaw === "next7days" || smartViewRaw === "inbox"
    ? smartViewRaw
    : null;
```

Then in the Prisma `where` clause construction, if `smartView === "inbox"` add `spaceId: null` to narrow the DB query (avoids loading all tasks just to filter). For `today` / `next7days`, do NOT try to push the date filter into Prisma (SQLite date math in Prisma is awkward) — load candidates and apply `filterBySmartView` in-app:

```typescript
// After fetching tasks from Prisma:
let tasks = await prisma.task.findMany({ where, orderBy, include: { children: true } });
if (smartView) {
  tasks = filterBySmartView(tasks as unknown as Task[], smartView);
}
```

Note: the `as unknown as Task[]` cast bridges the Prisma row shape (Date objects) to the `Task` interface (ISO strings). If the route currently serializes dates with `.toISOString()`, do that serialization BEFORE applying `filterBySmartView` so types match. Inspect the existing return statement and order operations accordingly.

- [ ] **Step 2: Update `useTasks` hook to accept `smartView`**

Open `src/components/tasks/use-tasks.ts`. Extend the input type and `fetchTasks`:

```typescript
export function useTasks(initialFilters?: {
  status?: string;
  spaceId?: string;
  smartView?: "today" | "next7days" | "inbox";
}) {
  // ... existing state ...

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams();
    if (initialFilters?.status) params.set("status", initialFilters.status);
    if (initialFilters?.spaceId) params.set("spaceId", initialFilters.spaceId);
    if (initialFilters?.smartView) params.set("smartView", initialFilters.smartView);
    params.set("parentId", "null"); // top-level only

    const res = await fetch(`/api/tasks?${params.toString()}`);
    // ... rest unchanged ...
  }, [initialFilters?.status, initialFilters?.spaceId, initialFilters?.smartView]);
  // ... rest unchanged ...
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Verify via curl**

Run dev server in background, then:

```bash
# Seed: assume you have at least one task with dueDate=today via UI
curl 'http://localhost:3000/api/tasks?smartView=today'
curl 'http://localhost:3000/api/tasks?smartView=inbox'
curl 'http://localhost:3000/api/tasks?smartView=next7days'
```

Expected: each returns `{ tasks: [...] }` with only matching tasks. An invalid value like `?smartView=bogus` should fall through to no filter (return all).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tasks/route.ts src/components/tasks/use-tasks.ts
git commit -m "feat(tasks): API + hook 支持 smartView 过滤参数"
```

---

## Task 7: Smart-view UI in TaskPanel

**Files:**
- Modify: `src/components/tasks/TaskPanel.tsx`

**Interfaces:**
- Consumes: `SmartView` type from T5, `useTasks({ smartView })` from T6.

- [ ] **Step 1: Read current TaskPanel.tsx structure**

Run: `head -50 src/components/tasks/TaskPanel.tsx`
Note where the existing list rendering starts. The smart-view segmented control goes above the list, full-width.

- [ ] **Step 2: Add segmented control state and UI**

At the top of the `TaskPanel` component function, add local state for the active smart view:

```tsx
import { useState } from "react";
import type { SmartView } from "@/lib/tasks/smart-views";

// Inside the component:
const [smartView, setSmartView] = useState<SmartView | null>(null);
```

Replace the existing `useTasks()` call (which currently passes nothing or only status/spaceId) to pass `smartView` when set:

```tsx
const { tasks, loading, ... } = useTasks(smartView ? { smartView } : undefined);
```

Insert this segmented control JSX above the task list (adjust class names to match existing panel styling):

```tsx
<div className="flex gap-1 mb-4 border-b border-border pb-2">
  {([
    { key: null, label: "全部" },
    { key: "today", label: "今天" },
    { key: "next7days", label: "最近 7 天" },
    { key: "inbox", label: "收集箱" },
  ] as { key: SmartView | null; label: string }[]).map((opt) => (
    <button
      key={opt.label}
      onClick={() => setSmartView(opt.key)}
      className={`px-3 py-1 text-sm rounded-md transition-colors ${
        smartView === opt.key
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent"
      }`}
    >
      {opt.label}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Verify manually**

Run: `pnpm dev`, open `/tasks`. Expected: segmented control appears above list. Clicking "今天"/"最近 7 天"/"收集箱" reloads the list with filtered tasks. Clicking "全部" returns to unfiltered.

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/TaskPanel.tsx
git commit -m "feat(tasks): TaskPanel 增加智能视图分段控件（全部/今天/最近7天/收集箱）"
```

---

## Task 8: Search-result mapping library (pure function, TDD)

**Files:**
- Create: `src/lib/tasks/search-result.ts`
- Test: `tests/unit/task-search-result.test.ts`

**Interfaces:**
- Produces: `taskToSearchResultItem(task)` returning `{ id, title, subtitle, href }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/task-search-result.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { taskToSearchResultItem } from "@/lib/tasks/search-result";

const base = {
  id: "t1",
  title: "完成产品介绍文章初稿",
  content: "",
  status: "todo" as const,
  priority: 3 as const,
  dueDate: "2026-07-20T08:00:00.000Z",
  dueTime: null,
  isAllDay: true,
  completedAt: null,
  parentId: null,
  spaceId: null,
  sortOrder: 0,
  tagsJson: "[]",
  isCollapsed: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
};

describe("taskToSearchResultItem", () => {
  it("title 取 task.title；subtitle 含状态标签 + 截止日", () => {
    const r = taskToSearchResultItem(base);
    expect(r.id).toBe("t1");
    expect(r.title).toBe("完成产品介绍文章初稿");
    expect(r.subtitle).toContain("待办");
    expect(r.subtitle).toContain("7月20日");
    expect(r.href).toBe("/tasks");
  });

  it("空 title → 用「无标题任务」兜底", () => {
    const r = taskToSearchResultItem({ ...base, title: "" });
    expect(r.title).toBe("无标题任务");
  });

  it("priority=4 → subtitle 含「紧急」", () => {
    const r = taskToSearchResultItem({ ...base, priority: 4 });
    expect(r.subtitle).toContain("紧急");
  });

  it("status=done → subtitle 含「已完成」", () => {
    const r = taskToSearchResultItem({ ...base, status: "done" });
    expect(r.subtitle).toContain("已完成");
  });

  it("status=cancelled → subtitle 含「已取消」", () => {
    const r = taskToSearchResultItem({ ...base, status: "cancelled" });
    expect(r.subtitle).toContain("已取消");
  });

  it("dueDate=null → subtitle 不含日期段", () => {
    const r = taskToSearchResultItem({ ...base, dueDate: null });
    expect(r.subtitle).not.toContain("月");
  });

  it("href 恒为 /tasks", () => {
    expect(taskToSearchResultItem(base).href).toBe("/tasks");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/unit/task-search-result.test.ts`
Expected: FAIL with "Failed to resolve import @/lib/tasks/search-result".

- [ ] **Step 3: Implement `src/lib/tasks/search-result.ts`**

```typescript
import type { Task } from "@/components/tasks/types";

export type TaskSearchInput = Pick<
  Task,
  "id" | "title" | "status" | "priority" | "dueDate"
>;

export type TaskSearchResultItem = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

const STATUS_LABEL: Record<Task["status"], string> = {
  todo: "待办",
  in_progress: "进行中",
  done: "已完成",
  cancelled: "已取消",
  archived: "已归档",
};

const PRIORITY_LABEL: Record<Task["priority"], string> = {
  0: "",
  1: "低",
  2: "中",
  3: "高",
  4: "紧急",
};

/** 任务 → 全局搜索结果项。纯函数，不依赖 React / prisma。 */
export function taskToSearchResultItem(t: TaskSearchInput): TaskSearchResultItem {
  const parts: string[] = [STATUS_LABEL[t.status]];
  if (t.priority > 0) parts.push(PRIORITY_LABEL[t.priority]);
  if (t.dueDate) {
    const d = new Date(t.dueDate);
    parts.push(`${d.getMonth() + 1}月${d.getDate()}日`);
  }
  return {
    id: t.id,
    title: t.title || "无标题任务",
    subtitle: parts.join(" · "),
    href: "/tasks",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/task-search-result.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/search-result.ts tests/unit/task-search-result.test.ts
git commit -m "feat(tasks): taskToSearchResultItem 纯函数 + 单测"
```

---

## Task 9: Wire tasks into GlobalSearch

**Files:**
- Modify: `src/app/api/search/route.ts`
- Modify: `src/components/common/GlobalSearch.tsx`

**Interfaces:**
- Consumes: `taskToSearchResultItem` from T8.

- [ ] **Step 1: Extend the search API route**

Open `src/app/api/search/route.ts`. Three edits:

(a) Add `tasks: SearchResultItem[]` to the `SearchResult` type:

```typescript
export type SearchResult = {
  articles: SearchResultItem[];
  spaces: SearchResultItem[];
  assets: SearchResultItem[];
  skills: SearchResultItem[];
  snippets: SearchResultItem[];
  tasks: SearchResultItem[];
};
```

(b) Add `tasks: []` to both `empty` constant and the empty-return object:

```typescript
const empty: SearchResult = {
  articles: [],
  spaces: [],
  assets: [],
  skills: [],
  snippets: [],
  tasks: [],
};
```

(c) Import the helper and add a `prisma.task.findMany` to the `Promise.all`, then map:

At top of file:
```typescript
import { taskToSearchResultItem } from "@/lib/tasks/search-result";
```

Add to the `Promise.all` array (after snippets):
```typescript
prisma.task.findMany({
  where: { status: { not: "archived" } },
  select: { id: true, title: true, status: true, priority: true, dueDate: true },
}),
```

Update the destructuring to include `tasks` as the 6th element:
```typescript
const [articles, spaces, assets, skills, snippets, tasks] = await Promise.all([...]);
```

Add `tasks` mapping to the result object:
```typescript
tasks: tasks
  .filter((t) => match(t.title))
  .slice(0, 20)
  .map((t) => taskToSearchResultItem(t)),
```

- [ ] **Step 2: Extend `GlobalSearch.tsx`**

Open `src/components/common/GlobalSearch.tsx`. Three edits:

(a) Add `tasks: ResultItem[]` to the `SearchResult` type (after snippets):
```typescript
type SearchResult = {
  articles: ResultItem[];
  spaces: ResultItem[];
  assets: ResultItem[];
  skills: ResultItem[];
  snippets: ResultItem[];
  tasks: ResultItem[];
};
```

(b) Add `tasks: []` to the `EMPTY` constant.

(c) Update `total` calculation to include `result.tasks.length`:
```typescript
const total =
  result.articles.length +
  result.spaces.length +
  result.assets.length +
  result.skills.length +
  result.snippets.length +
  result.tasks.length;
```

(d) Import `CheckSquare` from lucide-react (add to the existing import line) and render a new ResultSection after snippets:
```tsx
{result.tasks.length > 0 && (
  <ResultSection
    title="任务"
    icon={<CheckSquare className="h-4 w-4" />}
    items={result.tasks}
    onSelect={go}
  />
)}
```

(e) Update the placeholder/aria text to mention 任务 — change `placeholder="搜索文章、空间、素材、技能、灵感…"` to `placeholder="搜索文章、空间、素材、技能、灵感、任务…"` and the DialogDescription similarly.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Verify manually**

Run: `pnpm dev`. Open the home page. Click the search icon. Type the first few characters of an existing task's title. Expected: a "任务" section appears in results with the matching task. Click it — should navigate to `/tasks`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/search/route.ts src/components/common/GlobalSearch.tsx
git commit -m "feat(search): GlobalSearch 集成任务源"
```

---

## Verification (after all 9 tasks)

- [ ] **Final smoke test**

```bash
pnpm typecheck && pnpm test && pnpm lint
```

All three must pass.

- [ ] **Run graphify update to refresh the code graph**

```bash
graphify update .
```

- [ ] **Manual end-to-end smoke test**

1. Open `/tasks` — page loads.
2. Press `Cmd+Shift+T` — QuickAdd opens.
3. Create a task with title "测试任务 A" and due date = today.
4. Click "今天" in segmented control — task A visible.
5. Click "收集箱" — task A NOT visible (it has a space? depends on default). Create a task with no space → it shows in 收集箱.
6. Go to home page, click search, type "测试任务" — task A appears under 任务 section.
7. Change task A's status to "已取消" — title strikethrough, badge shows 已取消.

---

## Self-Review Notes

**Spec coverage** (reconciliation doc §6 阶段 A items → tasks):
- 补 isAllDay + dueTime 字段 → T3 ✓
- 快捷键 Cmd+N → Cmd+Shift+T → T2 ✓
- 修订设计文档 §1.1：sidebar → header → T1 ✓
- 加 cancelled 枚举（保持小写） → T4 ✓
- GlobalSearch 集成 tasks → T8 + T9 ✓
- 调整索引为复合索引 → T3 (same migration) ✓
- Phase 2 智能视图 → T5 + T6 + T7 ✓

**Placeholder scan**: none. All code blocks contain real, copy-pasteable code. All grep/curl commands have expected outputs.

**Type consistency**:
- `SmartView` type defined in T5 `src/lib/tasks/smart-views.ts`, consumed in T6 and T7 with same union.
- `Task.dueTime` / `Task.isAllDay` added in T3 schema, surfaced in T4 types.ts, consumed by T5 test fixtures and T8 input type.
- `taskToSearchResultItem` defined in T8, consumed in T9 with matching signature.

**Scope check**: 9 tasks, all under M total effort, no destructive migrations, every task independently committable and revertible.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-tasks-phase-a.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
