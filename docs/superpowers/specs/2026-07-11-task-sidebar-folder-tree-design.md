# 任务侧边栏：文件夹 + 任务清单树状重构

**日期：** 2026-07-11
**分支：** feat/tasks-phase-b → 续作
**背景：** 当前 `TaskSidebar` 复用外层 `Space` 模型组织任务，缺乏层级；用户要求改为滴答清单风格的「文件夹 → 任务清单」两级树状结构。

## 目标

将任务侧边栏从「扁平 Space 列表」重构为「文件夹 + 任务清单」两级树状结构，参考滴答清单（TickTick）交互：
- 顶层支持独立清单与文件夹混合
- 文件夹可展开/收起，内含任务清单
- 任务强制归属清单
- 移除收集箱（Inbox）概念
- Task 从 Space 完全解耦

## 范围

**纳入：**
- 新增 `TaskFolder` + `TaskList` 数据模型
- Task 从 `spaceId` 迁移到 `listId`
- 文件夹/清单 CRUD API
- TaskSidebar 树状重写
- QuickAddDialog 清单选择器
- 移除 Inbox 相关代码路径

**不纳入（YAGNI）：**
- 清单/文件夹拖拽排序（`sortOrder` 字段预留，无拖拽 UI）
- 清单图标自定义（仅彩色圆点）
- 清单内视图切换（列表/看板/日历）

## 架构决策

### 1. 树结构：混合模式

顶层「清单」section 同时允许：
- 顶层独立清单（`TaskList.folderId = null`）
- 文件夹（`TaskFolder`），文件夹下嵌套清单

最多两级：文件夹 → 清单。不支持更深嵌套。

### 2. 任务归属：强制清单

`Task.listId` 必填。QuickAddDialog 必须选择清单（默认填当前选中清单）。无「未分类/收集箱」概念。

### 3. Task 与 Space 完全解耦

移除 `Task.spaceId` 字段与 `Space` 关系。Article/Asset 仍各自用 Space，互不影响。

### 4. 展开/收起状态：DB 持久化

`TaskFolder.collapsed` 落库。单用户应用，无需 per-user localStorage。

### 5. 文件夹点击行为：选中并集视图

点文件夹名 = 选中该文件夹，TaskPanel 展示其下所有清单任务的并集。

## 数据模型

### 新增表

```prisma
model TaskFolder {
  id        String   @id @default(cuid())
  name      String
  sortOrder Int      @default(0)
  collapsed Boolean  @default(false)  // 展开/收起状态
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  lists     TaskList[]
}

model TaskList {
  id        String   @id @default(cuid())
  name      String
  color     String   @default("#6b7280")  // 预设色板
  folderId  String?  // null = 顶层独立清单
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  folder    TaskFolder? @relation(fields: [folderId], references: [id], onDelete: Restrict)
  tasks     Task[]
}
```

### Task 变更

- **移除：** `spaceId String?`、`space Space? @relation(...)`、`@@index([spaceId, status, sortOrder])`
- **新增：** `listId String`、`list TaskList @relation(fields: [listId], references: [id], onDelete: Restrict)`、`@@index([listId, status, sortOrder])`

### 删除语义

| 操作 | schema `onDelete` | handler 实际行为 |
|------|-------------------|------------------|
| 删文件夹 | `TaskList.folder → TaskFolder: Restrict` | handler 先 `UPDATE TaskList SET folderId = null WHERE folderId = ?`（清单提升为顶层），再 `DELETE TaskFolder` |
| 删清单 | `Task.list → TaskList: Restrict` | handler 先 `UPDATE Task SET trashed=true, trashedAt=now, expiresAt=now+30d WHERE listId = ?`（task 软删进垃圾箱），再 `DELETE TaskList` |
| 删 task | — | 不变（软删） |

**为何用 `Restrict` 而非 `Cascade`：** Cascade 会级联删子记录（删 folder → 清单和其下 task 全没），与「清单提升为顶层 / task 进垃圾箱」的业务语义冲突。`Restrict` 强制走 handler，保证删除前先做业务清理。

## API

### 新增：文件夹/清单 CRUD

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/tasks/folders` | 返回 `{ folders: [{ id, name, collapsed, sortOrder, lists: [...] }], standaloneLists: [...] }`，一次拿全树 |
| POST | `/api/tasks/folders` | body `{ name }` → 新建文件夹 |
| PATCH | `/api/tasks/folders/[id]` | body `{ name?, collapsed?, sortOrder? }` |
| DELETE | `/api/tasks/folders/[id]` | 删文件夹：清单提升为顶层（handler 先置 folderId=null） |
| POST | `/api/tasks/lists` | body `{ name, color?, folderId? }` → 新建清单 |
| PATCH | `/api/tasks/lists/[id]` | body `{ name?, color?, folderId?, sortOrder? }` |
| DELETE | `/api/tasks/lists/[id]` | 删清单：task 软删进垃圾箱（handler 先软删 task） |

### 改造现有

- **`GET /api/tasks/counts`** — 返回从 `{ total, inbox, bySpace, trashed }` 改为 `{ total, byList: Record<listId, number>, trashed }`。移除 `inbox` 字段。`total` = 所有未废弃任务数。
- **`GET /api/tasks`** — 查询参数 `spaceId` 改为 `listId`；新增 `folderId`（过滤 `list.folderId === folderId`）；移除 `smartView: "inbox"`
- **`POST /api/tasks`** — body `spaceId` 改为 `listId`（必填）
- **`PATCH /api/tasks/[id]`** — 支持 `listId` 字段（移动任务到其他清单）
- **`DELETE /api/tasks/[id]`**、`restore`、`purge`、`reorder` — 不变

## UI 与交互

### SelectedKey 类型

```ts
// src/components/tasks/TaskSidebar.tsx 导出
export type SelectedKey =
  | { type: "all" }
  | { type: "folder"; id: string }
  | { type: "list"; id: string }
  | { type: "trash" };
```

### TaskSidebar 布局

```
┌──────────────────────────────┐
│ ☑ 全部任务              42   │
├──────────────────────────────┤
│ 清单                    [+]  │  ← section header + 新建按钮
│   ≡ ● 日常琐事      5        │  ← 顶层独立清单（●=清单色）
│   ≡ ● 读书笔记      3   ⋯   │  ← hover 出 ⋯ 菜单
│   ▼ 📁 2026工作         (12) │  ← 展开的文件夹
│     ≡ ● OKR         3        │
│     ≡ ● Q1计划       5   ⋯   │
│   ▶ 📁 个人事务         (8)  │  ← 收起的文件夹
├──────────────────────────────┤
│ 🗑 垃圾箱                3   │
│ #  标签管理                  │
└──────────────────────────────┘
```

### 交互细节

1. **新建入口**
   - 「清单」header 右侧 `[+]` → 弹小菜单「新建文件夹 / 新建清单」
   - 文件夹行 hover → 右侧 `[+]`，直接往该文件夹加清单
2. **新建/编辑清单 Dialog**：名称输入 + 色板（8 色预设，复用 Tag 的 `PRESET_TAG_COLORS`）+ 文件夹下拉（可选）
3. **展开/收起**：点文件夹左侧 `▶/▼` 切换，状态写回 `PATCH /api/tasks/folders/[id] { collapsed }`
4. **文件夹点击**：点文件夹名 = 选中该文件夹（`SelectedKey = { type: "folder", id }`），TaskPanel 展示并集
5. **清单行 hover** → 右侧 `⋯` 菜单：重命名 / 改色 / 移动到文件夹 / 删除
6. **选中态**：`bg-primary text-primary-foreground`
7. **计数**：
   - 清单右侧 = 该清单未完成任务数（`status != "done" && !trashed`）
   - 文件夹右侧 = 文件夹下所有清单任务合计
   - 全部任务 = 所有未废弃任务

### 改动组件清单

| 组件 | 改动 |
|------|------|
| `TaskSidebar.tsx` | 重写：fetch `/api/tasks/folders`；渲染树；新建/编辑/删除入口 |
| `tasks/page.tsx` | `SelectedKey` 适配；folder/list 映射为 `folderId`/`listId` 传 TaskPanel |
| `TaskPanel.tsx` | props `spaceId?` → `listId?` + `folderId?` |
| `use-tasks.ts` | `spaceId` → `listId` + `folderId`（filter + create 参数） |
| `QuickAddDialog.tsx` | 新增清单选择器（必填，默认当前选中清单） |
| `TrashView.tsx` | task 的 space 标签改为 list 标签（彩色圆点 + 清单名） |
| `smart-views.ts` | 移除 inbox smartView |

### 新建组件

| 组件 | 职责 |
|------|------|
| `TaskListDialog.tsx` | 新建/编辑清单（名称 + 色板 + 文件夹下拉） |
| `TaskFolderDialog.tsx` | 新建/重命名文件夹（仅名称） |
| 行内 `⋯` 菜单 | 清单行的重命名/改色/移动/删除（可用 dropdown menu） |

### 新建 lib

`src/lib/tasks/list-repo.ts`：folder/list CRUD 服务层，参考 `src/lib/snippets/tag-repo.ts` 模式。封装：
- `listFoldersWithLists()` — 全树查询
- `createFolder(name)` / `renameFolder(id, name)` / `deleteFolder(id)`（内置清单提升逻辑）
- `createList({ name, color, folderId })` / `updateList(id, patch)` / `deleteList(id)`（内置 task 软删逻辑）

## 迁移策略

新 migration `prisma/migrations/20260716000000_task_folder_list/migration.sql`：

1. `CREATE TABLE TaskFolder (...)`
2. `CREATE TABLE TaskList (...)`
3. `INSERT INTO TaskList (id, name, color, folderId, sortOrder, createdAt, updatedAt) VALUES ('cl_default_list_seed_fixed', '默认清单', '#6b7280', NULL, 0, current_timestamp, current_timestamp)`（用固定可读 id，便于 step 5 引用）
4. `CREATE TABLE new_Task`（复制 Task 结构，移除 `spaceId`，新增 `listId TEXT NOT NULL REFERENCES TaskList(id) ON DELETE RESTRICT`）
5. `INSERT INTO new_Task SELECT [所有非 spaceId 列], 'cl_default_list_seed_fixed' AS listId FROM Task`
6. `DROP TABLE Task`
7. `ALTER TABLE new_Task RENAME TO Task`
8. 重建索引（`CREATE INDEX Task_listId_status_sortOrder_idx ON Task(listId, status, sortOrder)` 等）

**时间戳要求：** `20260716` > `20260715`（task_phase_b_tags_trash），保证自定义 migration runner 正确排序。

## 收集箱移除清单

- [ ] `SelectedKey.inbox` 类型分支
- [ ] `TaskSidebar` 的「收集箱」行
- [ ] `counts` API 的 `inbox` 字段
- [ ] `smart-views.ts` 的 `inbox` SmartView
- [ ] `use-tasks.ts` 的 `smartView: "inbox"` 类型
- [ ] `GET /api/tasks` 的 `smartView=inbox` 查询分支
- [ ] `tasks/page.tsx` 中 `selected.type === "inbox"` 的映射注释

存量 `spaceId = null` 的任务在迁移中归入「默认清单」。

## Task 类型变更

`src/components/tasks/types.ts`：

```ts
// 旧
interface Task {
  // ...
  spaceId: string | null
  space?: { id: string; name: string }
}

// 新
interface Task {
  // ...
  listId: string
  list?: { id: string; name: string; color: string; folderId: string | null; folder?: { id: string; name: string } | null }
}
```

API 返回的 task 对象用 `include` 展平 `list.folder`。

## 测试策略

- 改造涉及 `spaceId` / `inbox` 的既有测试用例为 `listId`
- 新增 `list-repo.test.ts`：folder/list CRUD + 删除语义（folder 删 → 清单提升；list 删 → task 软删）
- 新增 `tasks-folder-list-api.test.ts`：API 端到端
- migration 测试：空库 + 有 task 存量两种场景

## 风险

1. **migration runner 排序**：上一次已踩过时间戳排序坑（`20260711` < `20260713`）。本次新 migration 必须用 `20260716` 保证排在最后。
2. **Task.spaceId 移除影响面**：所有引用 `task.spaceId` 的代码路径都要改。需全局搜索确认无遗漏。
3. **删除语义边界**：`onDelete: Restrict` 要求 handler 必须先清理子记录，否则删 folder/list 会失败。handler 要有显式顺序。
