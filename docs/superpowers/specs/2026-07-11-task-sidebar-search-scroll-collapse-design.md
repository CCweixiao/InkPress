# 任务侧边栏：搜索 + 滚动 + Section 折叠 + 标签管理迁移

**日期：** 2026-07-11
**分支：** feat/tasks-phase-b（续作）
**背景：** 文件夹/清单/标签树状侧边栏已完成。用户要求优化大量数据时的可用性：搜索、固定高度滚动、section 折叠、标签管理入口迁移。

## 目标

- 侧边栏新增搜索框，支持模糊搜索文件夹/清单/标签/任务名，下拉浮层展示结果并点击跳转
- 树状区域（清单 + 标签）包进滚动容器，内容多时显示滚动条
- 清单和标签 section 各自可折叠/展开
- 删除底部「标签管理」按钮，图标迁到标签 section header

## 范围

**纳入：**
- 搜索框（防抖 + 客户端过滤文件夹/清单/标签 + 服务端搜任务）
- 搜索下拉浮层（三组结果，点击跳转）
- 任务高亮机制（点击任务 → 跳到清单 + 高亮）
- 中间区域滚动容器
- 清单/标签 section 折叠（客户端 state）
- 标签管理入口迁移

**不纳入（YAGNI）：**
- 搜索历史 / 最近搜索
- 全文搜索（仅 title contains）
- Section 折叠状态持久化
- 搜索快捷键

## 架构决策

### 1. 搜索：混合模式

文件夹/清单/标签数据已在侧边栏内存中 → 客户端实时过滤。任务数据未加载 → 服务端 `GET /api/tasks?q=...&limit=10`。300ms 防抖避免高频请求。

### 2. 点击任务 → 跳到清单 + 高亮

`SelectedKey` 不改（仍选 list）。page.tsx 新增 `highlightTaskId` state 传给 TaskPanel。TaskPanel 收到后滚动到目标行 + 2 秒高亮动画，然后清除 state。

### 3. Section 折叠：纯客户端

`useState<{ lists: boolean; tags: boolean }>`，默认全展开。不落库不存 localStorage。

### 4. 滚动容器：flex 弹性布局

顶部（全部任务 + 搜索框）和底部（垃圾箱）固定，中间树区域 `flex-1 overflow-y-auto min-h-0`。不硬编码像素高度。

## API

### `GET /api/tasks` 新增 `q` 参数

```
GET /api/tasks?q=周报&limit=10
```

- `q` 非空时：`where.title = { contains: q, mode: "insensitive" }`（SQLite 的 contains 默认大小写不敏感）
- 排除 `trashed: true` 的任务
- `limit` 默认 10，上限 20
- 忽略 `listId`/`folderId`/`tagId` 等其他过滤（搜索是全局的）
- 返回结构不变：`{ tasks: [...] }`，每个 task 含 `list` 关系（用于显示所属清单）

### 无其他新增 API

文件夹/清单/标签搜索纯客户端，复用已加载的数据。

## UI 与交互

### 搜索框

```
┌──────────────────────────────┐
│ ☑ 全部任务              42   │
├──────────────────────────────┤
│ 🔍 搜索文件夹/标签/任务...  │  ← Search 输入框（300px 宽）
├──────────────────────────────┤
│ ▼ 清单              [⇕][📁][+]│
│ ...                          │
└──────────────────────────────┘
```

- 位置：全部任务之下、清单 section 之上
- 左侧 `Search` 图标（lucide），右侧 × 按钮（有输入时显示）
- placeholder: `搜索文件夹/标签/任务...`
- 300ms 防抖；输入清空时关闭浮层
- Esc 关闭浮层并清空输入

### 下拉浮层

输入触发后，搜索框下方显示绝对定位浮层：

```
┌──────────────────────────────┐
│ 文件夹/清单                   │
│   📁 工作                     │
│   ≡ 日常琐事                  │
│ 标签                          │
│   ● 工作紧急                  │
│ 任务                          │
│   ☐ 写周报     [日常琐事]     │
│   ☐ 买牛奶     [生活]         │
└──────────────────────────────┘
```

- 浮层 `absolute` 定位，`z-50`，背景 `bg-popover border rounded-md shadow-md`
- 分三组：`文件夹/清单`、`标签`、`任务`
- 每组最多 5 条，总计最多 15 条
- 空组不显示标题
- 全部为空时显示「无匹配结果」占位

**结果行交互：**
- hover `bg-accent`
- 文件夹/清单行：左侧图标（📁/≡）+ 名称
- 标签行：彩色圆点 + 名称
- 任务行：复选框图标 + 标题 + 右侧灰色 `[清单名]`
- 点击：
  - 文件夹 → `onSelect({ type: "folder", id })`
  - 清单 → `onSelect({ type: "list", id })`
  - 标签 → `onSelect({ type: "tag", id })`
  - 任务 → `onSelect({ type: "list", id: task.listId })` + 设置 `highlightTaskId = task.id`
  - 所有点击关闭浮层 + 清空搜索框

### 滚动容器

```tsx
<aside className="w-60 ... flex flex-col h-full">
  {/* 固定顶部 */}
  <button>全部任务</button>
  <SearchBox />

  {/* 可滚动中间区域 */}
  <div className="flex-1 overflow-y-auto min-h-0">
    {/* 清单 section */}
    {/* 标签 section */}
  </div>

  {/* 固定底部 */}
  <button>垃圾箱</button>
</aside>
```

### Section 折叠

```
▼ 清单              [⇕][📁][+]   ← 点击「清单」文字 = 折叠
▶ 清单              [⇕][📁][+]   ← 折叠态：隐藏所有文件夹/清单

▼ 🏷 标签           [⋯][+]       ← 展开态
▶ 🏷 标签           [⋯][+]       ← 折叠态
```

- header 左侧 `▼/▶` 箭头 + section 标题文字，点击切换
- 右侧操作按钮（⇕/📁/+ / ⋯）不触发折叠（`stopPropagation`）
- 折叠时隐藏该 section 下所有内容
- 标签 section header 左侧 `TagIcon`（`🏷`）点击打开 `TagManageDialog`

### 标签管理迁移

- 删除底部「标签管理」按钮（约第 779 行）
- 标签 section header 左侧加 `TagIcon`，`onClick={() => setTagOpen(true)}`
- `TagManageDialog` 挂载不变

## 改动组件清单

| 组件 | 改动 |
|------|------|
| `TaskSidebar.tsx` | 搜索框 + 下拉浮层 + 滚动容器 + section 折叠 + 删底部标签管理按钮 + 标签 header 加 TagIcon |
| `TaskPanel.tsx` | 新增 `highlightTaskId?: string` prop；滚动到目标行 + 2 秒高亮 |
| `tasks/page.tsx` | 新增 `highlightTaskId` state，传 TaskPanel |
| `src/app/api/tasks/route.ts` | GET 新增 `q` 查询参数 |

## 搜索实现：内联到 TaskSidebar

不新建独立 `SidebarSearch` 组件——搜索需要访问 folders/standaloneLists/tags/counts 等多项 TaskSidebar state，拆出去会 prop drill 6+ 个 props。搜索框 + 浮层直接内联到 TaskSidebar，用一个 `useMemo` 算过滤结果 + 一个防抖 state 管理。

TaskSidebar 当前已 800+ 行，但搜索内联只需 ~80 行（input + 浮层 JSX + useMemo），可接受。

## TaskPanel 高亮机制

```tsx
interface TaskPanelProps {
  listId?: string;
  folderId?: string;
  tagId?: string;
  highlightTaskId?: string;  // ← 新增
  onHighlightConsumed?: () => void;  // ← 高亮动画完成后回调，清除 state
  view?: "main" | "trash";
}
```

- `highlightTaskId` 变化时：useEffect 滚动到该任务 DOM 节点（`scrollIntoView({ behavior: "smooth", block: "center" })`）
- 该行加 `ring-2 ring-primary animate-pulse` 2 秒
- 2 秒后调 `onHighlightConsumed()` 清除父级 state

## 测试策略

- API：`GET /api/tasks?q=...` 返回正确结果（title contains、排除 trashed、limit 生效）
- 组件测试可选（项目目前无组件测试基础设施，手动验证）

## 风险

1. **搜索浮层 z-index**：需高于 sidebar 其他元素（`z-50`），低于全局 dialog（dialog 是 `z-[100]`）
2. **highlightTaskId 时序**：切换 list 后 TaskPanel 重新 fetch tasks，highlightTaskId 必须在 tasks 加载完成后才生效。用 `useEffect` 监听 tasks + highlightTaskId 双依赖。
3. **q 参数与其他 filter 冲突**：搜索是全局的，q 存在时忽略 listId/folderId/tagId。route.ts 用 early return 处理。
4. **搜索内联到 TaskSidebar**：搜索逻辑直接内联（非独立组件），用 useMemo 算过滤结果。避免 prop drilling。
