# Tasks Phase B 设计：空间导航 + 彩色标签 + 任务垃圾箱

> **For agentic workers:** 本设计为 Phase B 任务管理增强，覆盖空间（文件夹）导航、全局彩色标签、任务软删除垃圾箱三大特性。实施阶段使用 superpowers:writing-plans 生成实现计划。

**目标：** 让任务能像笔记一样按空间（文件夹）组织、用带颜色的全局标签分类（个人事项/家务杂项/项目等），并把当前的硬删除升级为可恢复的软删除垃圾箱（30 天自动清理），三个特性一次交付。

**架构：** 在现有 `Task`/`Space` 模型基础上新增 `Tag` + `TaskTag` 多对多关联表，给 `Task` 增加软删除三件套（`trashed`/`trashedAt`/`expiresAt`，复用 Space/Article 的回收站字段模式）。前端在 `/tasks` 页新增左侧侧边栏承载空间导航与垃圾箱入口，新增标签管理弹窗与垃圾箱视图。

**技术栈：** Next.js 16 / React 19 / Prisma 7 + SQLite / vitest。纯函数放 `src/lib/tasks/`，组件放 `src/components/tasks/`，API 放 `src/app/api/tasks/` 与 `src/app/api/tags/`。

## 全局约束

- 标签仅用于任务，不触碰 `Space.tagsJson` / `Article.tagsJson`（保持现状）。
- 软删除字段语义与 Space/Article 一致：`trashed` 标记、`trashedAt` 时间戳、`expiresAt = trashedAt + 30 天`。
- 过期清理走懒清理（查询时过滤 + 顺手删除已过期记录），不引入 cron / 后台任务。
- `tagsJson` 字段保留只读兼容，迁移后新读写全部走 `TaskTag` 关联表。
- 中文 UI 文案；组件遵循 shadcn/ui + Tailwind 既有风格。
- 纯函数优先单测；API 层以纯函数覆盖为主。

---

## 1. 数据模型（`prisma/schema.prisma`）

### 1.1 新增 `Tag` 模型

```prisma
model Tag {
  id        String    @id @default(cuid())
  name      String    @unique      // 标签名，全局唯一
  color     String    @default("#6b7280") // 颜色 hex，默认灰
  sortOrder Int       @default(0)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  tasks     TaskTag[]
}
```

### 1.2 新增 `TaskTag` 关联表（多对多）

```prisma
model TaskTag {
  taskId String
  tagId  String
  task   Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  tag    Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([taskId, tagId])
  @@index([tagId])
}
```

- 复合主键 `@@id([taskId, tagId])` 自带主键索引；`@@index([tagId])` 支持按标签反查关联。
- `onDelete: Cascade`：删任务自动清关联，删标签自动清关联（任务保留）。

### 1.3 `Task` 模型新增软删除字段

```prisma
trashed   Boolean   @default(false)
trashedAt DateTime?
expiresAt DateTime?  // trashedAt + 30 天
```

- `status` 默认值不变（`todo`）。软删除独立于 status——trashed 任务不论原 status 都从主视图隐藏。
- 新增 `@@index([trashed])` 用于过滤已废弃任务。
- `tagsJson` 保留（只读兼容），不删除，避免破坏性改动。
- `Task` 侧新增反向关联：`tags TaskTag[]`。

### 1.4 迁移与数据迁移

新建 `prisma/migrations/<timestamp>_task_phase_b_tags_trash/migration.sql`：

1. `CREATE TABLE Tag`、`CREATE TABLE TaskTag`（含索引）。
2. `ALTER TABLE Task ADD COLUMN trashed BOOLEAN NOT NULL DEFAULT 0;`
3. `ALTER TABLE Task ADD COLUMN trashedAt DATETIME;`
4. `ALTER TABLE Task ADD COLUMN expiresAt DATETIME;`
5. `CREATE INDEX Task_trashed_idx ON Task(trashed);`
6. 数据迁移：遍历 `Task.tagsJson`（JSON 字符串数组），对每个唯一标签名 `INSERT OR IGNORE INTO Tag (id, name, color, sortOrder, createdAt, updatedAt) VALUES (...)`（默认色 `#6b7280`，cuid 由应用层生成或在 SQL 里用 `lower(hex(randomblob(8)))` 拼装）。
7. 为每个任务的每个标签补 `INSERT OR IGNORE INTO TaskTag (taskId, tagId) VALUES (...)`，`tagId` 通过 `SELECT id FROM Tag WHERE name = ?` 反查。

迁移幂等：用 `INSERT OR IGNORE` 保证重复执行不报错。

---

## 2. API 层

### 2.1 Task API 改造（`src/app/api/tasks/`）

**`GET /api/tasks`**（`route.ts`）

- `where` 默认追加 `trashed: false`。
- 新增查询参数 `?trashed=true`：查询垃圾箱视图。此时只返回 **trashed root**（`trashed: true AND (parentId IS NULL OR parent.trashed = false)`），避免被级联废弃的后代重复出现。Prisma 写法：`where: { trashed: true, OR: [{ parentId: null }, { parent: { trashed: false } }] }`。`parentId=null` 参数在此模式下被忽略。
- `?trashed` 缺省时（主视图）：`trashed: false`，与现有 `spaceId`/`status`/`smartView`/`parentId` AND 组合。
- 返回的任务对象 `include: { tags: { include: { tag: { select: { id, name, color } } } } }`，序列化为 `task.tags: [{ id, name, color }]`。

**软删除 / 恢复的「trashed root」模型（关键约束）**

为保证垃圾箱视图与恢复语义清晰，定义：

- **trashed root** = 被废弃的任务 **且**（`parentId` 为空 **或** 其父任务未被废弃）。
- 软删除某个任务时：标记该任务 **及其所有后代** 为 trashed（级联向下）。被删任务即成为一个 trashed root（其父要么不存在、要么未废弃）。
- 恢复某个 trashed root 时：清除该任务 **及其所有被废弃的后代** 的 trashed 标记（级联向下恢复整棵子树）。**不需要**向上遍历父链——因为 trashed root 的父必然未废弃。
- 垃圾箱视图只展示 trashed root（不重复展示被级联废弃的后代）。

**`DELETE /api/tasks/:id`**（`[id]/route.ts`）改为软删除

- `prisma.task.update({ where: { id }, data: { trashed: true, trashedAt: now, expiresAt: now + 30d } })`。
- 级联子任务：递归遍历所有后代 children（`where: { parentId: id }`，含已废弃的），同样打上 `trashed`/`trashedAt`/`expiresAt`。
- 不再调用 `prisma.task.delete`。

**新增 `POST /api/tasks/:id/restore`**（`[id]/route.ts`）

- 清除该任务 **及其所有被废弃后代** 的 trashed 三字段（递归 children，仅清 `trashed: true` 的）。
- 不向上遍历父链（trashed root 的父必然未废弃）。

**新增 `DELETE /api/tasks/:id/purge`**（`[id]/route.ts`）

- `prisma.task.delete({ where: { id } })`（cascade children）。
- 这是唯一真正删除数据的端点，仅在垃圾箱视图暴露。
- 路由约定：`?mode=purge` query 参数 vs 独立路径段。采用独立路径段 `/api/tasks/:id/purge` 更清晰。

**`PATCH /api/tasks/:id`**（`[id]/route.ts`）扩展 `tagIds`

- body 新增可选 `tagIds?: string[]`（全量覆盖该任务的标签集合）。
- 收到 `tagIds` 时，在事务内：`prisma.taskTag.deleteMany({ where: { taskId: id } })` + `prisma.taskTag.createMany({ data: tagIds.map(tagId => ({ taskId: id, tagId })) })`。
- 其他字段更新逻辑不变。

**`POST /api/tasks`**（`route.ts`）扩展 `tagIds`

- body 新增可选 `tagIds?: string[]`。创建任务后在同一事务内 `createMany` 写入 `TaskTag`。

### 2.2 Tag API（全新，`src/app/api/tags/`）

**`GET /api/tags`**（`route.ts`）

- 返回 `[{ id, name, color, sortOrder, _count: { tasks } }]`，按 `sortOrder` 升序、`name` 升序。
- `_count.tasks` 只计 `trashed: false` 的任务。

**`POST /api/tags`**（`route.ts`）

- body `{ name: string, color?: string }`。
- `name` trim 后非空，唯一约束；冲突返回 409 `{ error: "标签名已存在" }`。
- `color` 缺省 `#6b7280`。

**`PATCH /api/tags/:id`**（`[id]/route.ts`）

- body `{ name?, color?, sortOrder? }`。`name` 改名时唯一约束冲突返回 409。

**`DELETE /api/tags/:id`**（`[id]/route.ts`）

- `prisma.tag.delete({ where: { id } })`（cascade 自动清 `TaskTag`，任务保留）。

### 2.3 任务计数聚合（`src/app/api/tasks/counts/route.ts`，新）

- `GET /api/tasks/counts` 返回侧边栏所需计数，避免 N+1：
  ```json
  {
    "total": 12,
    "inbox": 3,
    "bySpace": { "<spaceId>": 5, ... },
    "trashed": 1
  }
  ```
- `total`/`inbox`/`bySpace` 只统计 `trashed: false` 的任务。
- `trashed` 统计 **trashed root** 数量（与垃圾箱视图一致），查询条件同 2.1 的 `?trashed=true`。
- `total`/`inbox`/`bySpace` 用 `prisma.task.groupBy({ where: { trashed: false }, by: ["spaceId"], _count: true })` 一次聚合；`trashed` 单独一次 count 查询（含 trashed root 的嵌套条件）。

### 2.4 过期懒清理

- 不新增端点。
- `GET /api/tasks`（不论 `trashed` 参数）执行前，先 `prisma.task.deleteMany({ where: { trashed: true, expiresAt: { lt: now } } })` 清掉已过期记录。
- 这保证 30 天到期任务在下次访问垃圾箱或主列表时自动消失。

---

## 3. 纯函数库（`src/lib/tasks/`）

### 3.1 `trash-lifecycle.ts`（新）

```ts
export const TRASH_RETENTION_DAYS = 30;

export function computeExpiresAt(trashedAt: Date, retentionDays = TRASH_RETENTION_DAYS): Date {
  return new Date(trashedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

export function isExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() < now.getTime();
}

export function daysLeft(expiresAt: Date | null, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  const ms = expiresAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}
```

### 3.2 `smart-views.ts`（改）

- `filterBySmartView` 入口先 `tasks.filter(t => !t.trashed)`，再走原有 today/next7days/inbox 谓词，防止垃圾箱任务混入智能视图。

### 3.3 `tag-colors.ts`（新）

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

export function normalizeColor(hex: string): string {
  // 透传合法 hex；非法回退默认灰
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : PRESET_TAG_COLORS[0];
}
```

---

## 4. 前端组件

### 4.1 任务页布局（`src/app/tasks/page.tsx`，改）

- 改为 `flex` 布局：左侧 `TaskSidebar`（240px 固定宽），右侧 `TaskPanel`（flex-1）。
- 侧边栏选中态提升到 `page.tsx`：`selectedKey: string | null`（`null` = 全部、`"inbox"` = 收集箱、`"<spaceId>"` = 某空间、`"trash"` = 垃圾箱）。
- 移动端：侧边栏改为 `Dialog` 抽屉，窄屏默认收起，顶部加汉堡按钮。
- 键盘快捷键 `⌘⇧T`（Phase A）保持不变。

### 4.2 `TaskSidebar.tsx`（新）

```
┌─────────────────────┐
│ 📋 任务             │
│                     │
│ 全部任务      (12)  │
│ 收集箱        (3)   │
│ ─────────────────── │
│ 📁 个人事项   (5)   │
│ 📁 家务杂项   (2)   │
│ 📁 项目 A     (4)   │
│ ─────────────────── │
│ 🗑 垃圾箱      (1)   │
│                     │
│ 🏷 标签管理         │
└─────────────────────┘
```

- `GET /api/tasks/counts` 一次拉取全部计数。
- 空间列表来自 `GET /api/spaces`（已有，过滤 `trashed=false`），与首页空间区块同源。
- 选中项高亮（`bg-primary text-primary-foreground`）。
- "标签管理"底部固定，点击打开 `TagManageDialog`。

### 4.3 `TagManageDialog.tsx`（新）

```
┌─ 标签管理 ────────────────────┐
│ 🔵 个人事项   5 个任务  ✏️ 🗑 │
│ 🟡 家务杂项   2 个任务  ✏️ 🗑 │
│ 🟠 项目       4 个任务  ✏️ 🗑 │
│ + 新建标签                    │
│   [名称] [🎨颜色] [保存]      │
└──────────────────────────────┘
```

- 复用 `Dialog`（shadcn）。
- 列表：每行颜色 dot + 名称 + 任务数 + 编辑/删除按钮。
- 编辑行内展开：名称 `<Input>` + 颜色 swatch（`PRESET_TAG_COLORS` 8 色）+ `<input type="color">` 自定义 + 保存/取消。
- 新建：底部表单，同字段。
- 删除：`useConfirm` 二次确认，文案"将解除 N 个任务的关联，任务本身保留"。
- CRUD 调 `/api/tags`，成功后本地刷新列表。

### 4.4 `TaskItem.tsx`（改）

**彩色标签展示**：替换现有灰色 pill（`tagsJson` 字符串，`TaskItem.tsx:185-196`）为彩色 dot + 名称。

```tsx
{task.tags?.length > 0 && (
  <div className="flex gap-1">
    {task.tags.slice(0, 2).map((t) => (
      <span key={t.id} className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
            style={{ backgroundColor: t.color + "22", color: t.color }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }} />
        {t.name}
      </span>
    ))}
    {task.tags.length > 2 && (
      <span className="text-xs text-muted-foreground">+{task.tags.length - 2}</span>
    )}
  </div>
)}
```

**标签赋值 Popover**：hover 出现的 actions 区（`TaskItem.tsx:218-239`）新增 `Tag` 图标按钮（lucide `Tag` icon），点击弹出 `Popover`：

```
┌─────────────┐
│ ☑ 🔵 个人事项 │
│ ☐ 🟡 家务杂项 │
│ ☑ 🟠 项目    │
└─────────────┘
```

- 多选复选框列表，勾选/取消即调用 `PATCH /api/tasks/:id { tagIds: [...] }`（全量覆盖）。
- 颜色 dot + 名称。空列表时提示"请先在标签管理中创建标签"。
- 不支持在此新建标签（必须先去标签管理建好，避免散落创建）。

### 4.5 `QuickAddDialog.tsx`（改）

新建任务表单（标题/优先级/截止日期）下方加"标签"行，同样的多选 `Popover`（复用一个 `TagPicker` 子组件）。提交时 `POST /api/tasks` body 带 `tagIds`。

### 4.6 `TagPicker.tsx`（新，共享）

TaskItem 的赋值 Popover 与 QuickAddDialog 的标签行共用一个 `TagPicker` 组件：
- props: `{ selectedIds: string[], onChange: (ids: string[]) => void }`。
- 内部 `GET /api/tags` 拉列表，渲染多选复选框 + 颜色 dot。
- 受控组件，选中态由父组件持有。

### 4.7 `TrashView.tsx`（新）

```
任务标题              📁 个人事项   🔵 个人   还剩 18 天   [恢复] [彻底删除]
```

- `GET /api/tasks?trashed=true`（垃圾箱后端只返回 trashed root：见第 2.1 节「trashed root 模型」。后端查询条件：`trashed: true AND (parentId IS NULL OR parent.trashed = false)`）。
- 每行：标题、空间名（`task.space?.name`，无空间显示"收集箱"）、标签 dot、剩余天数（`daysLeft(expiresAt)`）、恢复按钮、彻底删除按钮。
- 恢复：`POST /api/tasks/:id/restore`，成功后从列表消失（回到主视图对应空间）。
- 彻底删除：`DELETE /api/tasks/:id/purge`，`useConfirm` 二次确认"此操作不可撤销"。
- 空状态："垃圾箱是空的"。
- 排序：`trashedAt` 降序（最近删除的在上）。

### 4.8 `TaskPanel.tsx`（改）

- props 扩展：`view?: "main" | "trash"`（默认 `"main"`）、`spaceId?: string`（已有）。
- `view === "trash"` 时渲染 `<TrashView />`，隐藏 smart view 分段控件和 status 筛选器。
- `view === "main"` 保持现有 list/kanban/calendar。
- `useTasks` 传入 `trashed: view === "trash"`。

### 4.9 `use-tasks.ts`（改）

- `initialFilters` 扩展 `trashed?: boolean`。
- `fetchTasks` 追加 `params.set("trashed", "true")`（当 `trashed` 为真）。
- `deleteTask(id)` 不变（后端已改软删，前端无感）。
- 新增 `restoreTask(id)` → `POST /api/tasks/:id/restore`，成功后 refetch。
- 新增 `purgeTask(id)` → `DELETE /api/tasks/:id/purge`，成功后 refetch。
- `updateTask` 的 `Partial<Task>` 类型扩展 `tagIds?: string[]`。
- `createTask` 的 data 类型扩展 `tagIds?: string[]`。
- `toggleStatus` 维持 `done↔todo`（Phase A 现状，不在本次范围）。

---

## 5. 类型定义（`src/components/tasks/types.ts`，改）

```ts
export interface TaskTagInfo {
  id: string;
  name: string;
  color: string;
}

export interface Task {
  // ...现有字段...
  tags: TaskTagInfo[];        // 新增：替代 tagsJson 的结构化读取
  trashed: boolean;           // 新增
  trashedAt: string | null;   // 新增
  expiresAt: string | null;   // 新增
  // tagsJson 保留（只读兼容）
}
```

`STATUS_CONFIG` 已含 `cancelled`（Phase A），无需改。

---

## 6. 测试策略（vitest）

### 6.1 纯函数单测

- **`trash-lifecycle.test.ts`**：`computeExpiresAt`（30 天后日期）、`isExpired`（边界：恰好到期、已恢复 null、未来）、`daysLeft`（向上取整、0 下限）。
- **`tag-colors.test.ts`**：`normalizeColor`（合法 hex 透传、非法回退默认、边界大小写）。
- **`smart-views.test.ts`**（扩展现有）：新增用例——`filterBySmartView` 对 `trashed: true` 任务一律返回 false，即使其 dueDate 在今天。

### 6.2 不新增框架

API 层与组件层不引入新测试框架。API 行为以纯函数覆盖 + 手动验证为主；展示逻辑（剩余天数格式化）提取为纯函数后单测。

---

## 7. 错误处理

- Tag 创建/改名 `name` 冲突 → API 409，前端 inline 提示"标签名已存在"。
- 恢复/彻底删除失败 → toast/inline 错误，列表不变（乐观更新回滚）。
- 颜色值：前端 swatch 与 `<input type=color>` 保证产出合法 `#rrggbb`，后端透传不校验。

---

## 8. 不做的事（YAGNI）

- 不做标签拖拽排序（`Tag.sortOrder` 字段保留，UI 后续再加）。
- 不做按标签筛选任务的视图（侧边栏只列空间；标签只在任务上展示与赋值；按标签筛选拉到后续 phase）。
- 不动 `Space.tagsJson` / `Article.tagsJson`（仅任务）。
- 不引入 cron 定时任务，过期清理走懒清理。
- 不改 `toggleStatus` 的 `done↔todo` 逻辑。
- 不做标签的全局搜索集成（Phase A 的 `taskToSearchResultItem` 不含标签字段）。

---

## 9. 文件清单

**新建：**
- `prisma/migrations/<timestamp>_task_phase_b_tags_trash/migration.sql`
- `src/app/api/tags/route.ts`（GET/POST）
- `src/app/api/tags/[id]/route.ts`（PATCH/DELETE）
- `src/app/api/tasks/counts/route.ts`（GET）
- `src/app/api/tasks/[id]/restore/route.ts`（POST）
- `src/app/api/tasks/[id]/purge/route.ts`（DELETE）
- `src/lib/tasks/trash-lifecycle.ts`
- `src/lib/tasks/tag-colors.ts`
- `src/components/tasks/TaskSidebar.tsx`
- `src/components/tasks/TagManageDialog.tsx`
- `src/components/tasks/TagPicker.tsx`
- `src/components/tasks/TrashView.tsx`
- `tests/unit/task-trash-lifecycle.test.ts`
- `tests/unit/task-tag-colors.test.ts`

**修改：**
- `prisma/schema.prisma`（Tag、TaskTag 模型；Task 软删字段 + 反向关联）
- `src/app/api/tasks/route.ts`（GET 默认排除 trashed、include tags、懒清理；POST 支持 tagIds）
- `src/app/api/tasks/[id]/route.ts`（DELETE 改软删；PATCH 支持 tagIds）
- `src/components/tasks/types.ts`（Task 接口扩展）
- `src/components/tasks/use-tasks.ts`（trashed 过滤、restoreTask、purgeTask、tagIds）
- `src/components/tasks/TaskPanel.tsx`（view prop、TrashView 分流）
- `src/components/tasks/TaskItem.tsx`（彩色标签展示 + TagPicker Popover）
- `src/components/tasks/QuickAddDialog.tsx`（标签行 + TagPicker）
- `src/app/tasks/page.tsx`（flex 布局 + TaskSidebar）
- `src/lib/tasks/smart-views.ts`（filterBySmartView 过滤 trashed）
- `tests/unit/task-smart-views.test.ts`（新增 trashed 用例）
