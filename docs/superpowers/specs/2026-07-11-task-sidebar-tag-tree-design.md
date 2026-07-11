# 任务侧边栏：标签树 + 折叠全部 + 暗色配色调整

**日期：** 2026-07-11
**分支：** feat/tasks-phase-b（续作）
**背景：** 文件夹/清单树状重构已完成（10 个任务，commit `0aaa1105`，READY_TO_MERGE）。用户在此基础上提出 4 项调整：
1. 清单 section 支持一键展开/折叠所有文件夹
2. 标签与清单并列展示（不再是底部按钮）
3. 标签支持两级树状结构（类似文件夹/清单）
4. 暗模式下选中态亮蓝色刺眼，改为柔和配色

## 目标

在已完成的文件夹/清单树状侧边栏基础上：
- 新增「展开/折叠全部文件夹」入口
- 新增「标签」section，与「清单」并列，支持两级树状（一级 + 二级）
- 统一选中态配色为 `bg-accent text-accent-foreground`，解决暗模式刺眼问题

## 范围

**纳入：**
- Tag 模型新增 `parentId`（自关联，严格两级）
- 标签 CRUD API（含父子层级语义）
- TaskPanel 按 tag 过滤（一级走子标签并集）
- TaskSidebar 新增标签 section + 展开折叠全部按钮 + 选中态改 accent
- 新增 `TagEditDialog` 组件

**不纳入（YAGNI）：**
- 标签拖拽排序（本期不加，仅预留 `reorder` API）
- 三级及更深标签嵌套
- 标签图标自定义（仅彩色圆点）
- 标签展开/折叠状态持久化（纯客户端内存）

## 架构决策

### 1. 标签层级：严格两级，两级都可关联任务

`Tag.parentId` 可选。`null` = 一级标签；非空 = 二级标签。handler 校验：创建/移动时，目标 parent 的 `parentId` 必须为 `null`（即只能挂到一级标签下），禁止三级嵌套。

一级标签和二级标签都能被任务直接关联（类似滴答清单：父标签既可点选，也可展开看子标签）。

### 2. 点击标签的过滤语义：一级展开并集

- 点二级标签 → TaskPanel 展示「直接打该标签」的任务
- 点一级标签 → TaskPanel 展示「直接打该标签」+「所有子标签」任务的并集

与文件夹的并集语义一致。

### 3. 标签展开/折叠：纯客户端内存

标签树通常不长，展开/折叠状态用 `useState<Set<string>>` 管理，不落库。每次刷新默认全展开。

### 4. 选中态配色：统一 accent

所有 sidebar 选中行从 `bg-primary text-primary-foreground` 改为 `bg-accent text-accent-foreground font-medium`。`bg-accent` 在亮/暗模式都是柔和灰青色，暗模式下接近 `slate-800`，不刺眼。

### 5. 标签 CRUD：保留「标签管理」入口 + 行内 ⋯ 菜单

- section header `[+]` → 新建一级标签（弹 TagEditDialog）
- 标签行 hover → `⋯` 菜单：新建子标签 / 重命名 / 改色 / 移动到父级 / 删除
- 底部保留「标签管理」按钮 → 打开 `TagManageDialog`（批量整理入口）

## 数据模型

### Tag 模型变更

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
}
```

- `name` 保持全局 `@unique`（父子标签名也不可重复，简化心智）
- `onDelete: Restrict` + handler 显式清理子标签

### 删除语义

| 操作 | schema `onDelete` | handler 实际行为 |
|------|-------------------|------------------|
| 删一级标签 | `Tag.children → Tag: Restrict` | handler 先 `UPDATE Tag SET parentId=null WHERE parentId=?`（子标签提升为一级），再 `DELETE TaskTag WHERE tagId=?`（解绑），再 `DELETE Tag` |
| 删二级标签 | — | handler 先 `DELETE TaskTag WHERE tagId=?`（解绑），再 `DELETE Tag` |
| 删任意标签 | — | **不删 task**，task 保留，仅摘掉该 tag 关联 |

**为何用 `Restrict` 而非 `SetNull`：** `SetNull` 会让子标签静默提升，但 handler 还要同步解绑 TaskTag + 校验层级，统一走 Restrict 强制 handler 编排更安全。

### 迁移 `20260718000000_tag_parent_hierarchy`

时间戳 `20260718` > `20260717`（task_drop_spaceid），保证排序正确。

```sql
-- 1. 新表（含 parentId，无 FK 约束先建以避免循环引用问题）
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

-- 2. 复制数据（存量 tag 全部 parentId = NULL，即提升为一级）
INSERT INTO new_Tag (id, name, color, parentId, sortOrder, createdAt, updatedAt)
SELECT id, name, color, NULL, sortOrder, createdAt, updatedAt FROM Tag;

-- 3. 替换表
DROP TABLE Tag;
ALTER TABLE new_Tag RENAME TO Tag;

-- 4. 重建索引
CREATE UNIQUE INDEX Tag_name_key ON Tag(name);
CREATE INDEX Tag_parentId_idx ON Tag(parentId);
```

注：`defer_foreign_keys=ON` 在此不需要（无任务引用约束牵连，Tag 自关联在重建后即生效）。

## API

### Tag API（新增/改造）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/tags` | 返回扁平数组 `{ tags: [{ id, name, color, parentId, sortOrder }] }`，客户端自组树 |
| POST | `/api/tags` | body `{ name, color?, parentId? }`；校验 parentId 存在且 `parentId.parentId === null`（防三级） |
| PATCH | `/api/tags/[id]` | body `{ name?, color?, parentId?, sortOrder? }`；移动时校验：目标 parent 必须存在且为一级；禁止把自己设为自己后代的 parent（防环） |
| DELETE | `/api/tags/[id]` | handler：子标签 `parentId=null` → 解绑 TaskTag → 删 tag |
| POST | `/api/tags/reorder` | body `{ items: [{ id, sortOrder }] }` → 批量重排（本期 UI 不调用，预留） |

### Task API 改造

**`GET /api/tasks` 新增 `tagId` 查询参数（并集语义）：**

```ts
if (tagId) {
  // 查该 tag + 其所有二级子 tag 的 id
  const childTags = await prisma.tag.findMany({
    where: { parentId: tagId },
    select: { id: true },
  });
  const allTagIds = [tagId, ...childTags.map((t) => t.id)];
  where.AND.push({ tags: { some: { tagId: { in: allTagIds } } } });
}
```

点一级 tag → 并集（自身 + 所有子标签）；点二级 tag → 精确（allTagIds 只含自己，因 parentId 非空无子标签）。

**`GET /api/tasks/counts`** 新增 `byTag: Record<tagId, number>`：按 tag 直接关联统计未废弃任务数（不展开并集）。一级标签的并集计数 = 客户端聚合自身 `byTag[id]` + 所有子标签 byTag 之和。

### Folder API（新增）

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/tasks/folders/collapse-all` | body `{ collapsed: boolean }` → 批量更新所有 folder 的 collapsed 字段，返回更新后 folder 列表 |

## UI 与交互

### TaskSidebar 新布局

```
┌──────────────────────────────┐
│ ☑ 全部任务              42   │
├──────────────────────────────┤
│ 清单              [⇕][📁][+] │  ← ⇕ = 展开/折叠全部文件夹
│   ≡ ● 日常琐事      5   ⋯   │
│   ▼ 📁 2026工作         (12) │
│     ≡ ● OKR         3   ⋯   │
│   ▶ 📁 个人事务          (8)  │
├──────────────────────────────┤
│ 标签               [📁][+]   │  ← section header：新建一级/二级
│   ● 工作紧急        3        │  ← 顶层标签（无子，无展开箭头）
│   ▼ ● 生活               (5) │  ← 展开的一级标签（有子标签）
│     ● 健身         2        │  ← 二级标签（缩进）
│     ● 家庭         3        │
│   ● 读书笔记        4        │
├──────────────────────────────┤
│ 🗑 垃圾箱                3   │
│ #  标签管理                  │  ← 保留批量入口
└──────────────────────────────┘
```

### 展开/折叠全部文件夹

- 图标：`ChevronsDownUp`（全部展开时 → 点击折叠全部）/ `ChevronsUpDown`（存在折叠时 → 点击展开全部）
- 判定：`const allExpanded = folders.length > 0 && folders.every(f => !f.collapsed)`
- 点击行为：
  - `allExpanded === true` → 所有 folder `collapsed = true`
  - 否则 → 所有 folder `collapsed = false`
- 调用 `POST /api/tasks/folders/collapse-all { collapsed }`，乐观更新

### 标签 section

- 数据源：`GET /api/tags` 扁平数组，客户端组装为 `{ roots: Tag[] }`（roots = parentId 为 null，按 sortOrder 排序；每个 root 的 children 按 sortOrder 排序）
- 渲染：
  - 一级标签行：`[▶/▼] ● tagName (count) ⋯`（有子标签才显示展开箭头）
  - 二级标签行：`    ● tagName count ⋯`（缩进 `pl-6`）
- 计数：
  - 二级 = `byTag[tagId]`
  - 一级 = 自身 `byTag[tagId]` + 所有子标签 `byTag[childId]` 之和
- 点击：`onSelect({ type: "tag", id })` → TaskPanel 按 tagId 过滤
- 展开状态：`useState<Set<string>>`，默认全展开（首次加载所有 roots 都加入 set）

### 标签 ⋯ 菜单（hover 显示）

- 一级标签：新建子标签 / 重命名 / 改色 / 移动到父级（下拉，可选）/ 删除
- 二级标签：重命名 / 改色 / 移动到父级（改为另一个一级或「无父级」提升为一级）/ 删除

### 标签 section header 按钮

- `[+]` → 新建一级标签（弹 TagEditDialog，parentId = null）
- `[📁]` → 新建二级标签（弹 TagEditDialog，parentId 必选，下拉仅含一级标签）

### 选中态配色（全 sidebar 统一）

```tsx
// 旧
selected ? "bg-primary text-primary-foreground" : "hover:bg-accent hover:text-foreground"
// 新
selected ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/60 hover:text-foreground"
```

影响：全部任务 / 文件夹行 / 清单行 / 标签行 / 垃圾箱 行（5 处）。

## SelectedKey 类型

```ts
export type SelectedKey =
  | { type: "all" }
  | { type: "folder"; id: string }
  | { type: "list"; id: string }
  | { type: "tag"; id: string }
  | { type: "trash" };
```

## 改动组件清单

| 组件 | 改动 |
|------|------|
| `TaskSidebar.tsx` | 新增标签 section + 展开折叠全部按钮 + 选中态改 accent；fetch `/api/tags` |
| `TagEditDialog.tsx`（新建）| 新建/编辑标签（名称 + 色板 + 父标签下拉）|
| `TagManageDialog.tsx` | 保留现有批量入口（本期不改）|
| `tasks/page.tsx` | SelectedKey 映射加 `tag → tagId` |
| `TaskPanel.tsx` | props 新增 `tagId?` |
| `use-tasks.ts` | filter 新增 `tagId?` |

## 新建 lib

`src/lib/tasks/tag-repo.ts`：tag CRUD + 层级校验服务层，参考 `list-repo.ts` 模式：
- `listTagsFlat()` — 全量扁平查询
- `createTag({ name, color, parentId })` — 校验 parentId 为一级
- `updateTag(id, patch)` — 移动时校验目标为一级、防环
- `deleteTag(id)` — 子标签提升一级 + 解绑 TaskTag + 删 tag（事务）
- `reorderTags(items)` — 批量 sortOrder

## 改动 API 清单

| 文件 | 改动 |
|------|------|
| `src/app/api/tags/route.ts` | GET 返回扁平数组含 parentId；POST 支持 parentId |
| `src/app/api/tags/[id]/route.ts` | PATCH 支持 parentId 移动；DELETE 子提升一级 |
| `src/app/api/tags/reorder/route.ts`（新建）| 批量重排 |
| `src/app/api/tasks/route.ts` | GET 新增 `tagId` 查询参数（并集过滤）|
| `src/app/api/tasks/counts/route.ts` | 返回新增 `byTag` |
| `src/app/api/tasks/folders/collapse-all/route.ts`（新建）| 批量折叠/展开 |

## 测试策略

- 改造 `tag-repo.test.ts`：覆盖层级校验（三级拒绝、防环、子提升）
- 新增 `tags-api.test.ts`：CRUD + 移动 + 删除语义
- 新增 `tasks-tag-filter.test.ts`：一级 tag 并集、二级 tag 精确
- migration 测试：存量 tag 全部 parentId=null（提升为一级）

## 风险

1. **层级校验绕过**：API 层必须校验 parentId.parentId === null（防三级）+ 移动时防环。handler 层 + zod schema 双重保险。
2. **Tag.name 全局唯一**：父子标签也不能重名。已存在于 schema，迁移后保持。
3. **标签管理弹窗兼容**：现有 `TagManageDialog` 扁平列表展示，本期不改但需保证不报错（parentId 字段对其透明）。
4. **byTag 计数 vs 一级并集**：服务端 counts 仅返回直接关联数；一级标签的并集数由客户端聚合，避免 counts 接口膨胀。
