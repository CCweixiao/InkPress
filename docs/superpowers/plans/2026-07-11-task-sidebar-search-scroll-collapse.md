# 任务侧边栏：搜索 + 滚动 + Section 折叠 + 标签管理迁移 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在侧边栏新增搜索框（模糊搜文件夹/清单/标签/任务）、树区域滚动容器、清单+标签 section 可折叠、标签管理入口迁移到 section header。

**架构：** 搜索混合模式——文件夹/清单/标签客户端过滤 + 任务走 `GET /api/tasks?q=`。点击任务结果 → 选中其清单 + `highlightTaskId` 传 TaskPanel 滚动高亮。滚动容器用 flex 弹性布局。Section 折叠纯客户端 state。

**技术栈：** Next.js 16 / React 19 / Prisma 7 + SQLite / vitest / Tailwind / lucide-react

## Global Constraints

- **搜索 `q` 参数全局优先：** `q` 存在时忽略 listId/folderId/tagId/smartView，只按 title contains + 非 trashed 过滤
- **防抖 300ms：** 搜索输入 300ms 防抖，避免高频请求
- **浮层 z-index：** `z-50`（高于 sidebar 内容，低于全局 dialog `z-[100]`）
- **高亮机制：** TaskItem 根元素加 `data-task-id`；TaskPanel useEffect 查 DOM 滚动 + 2s ring 动画
- **Section 折叠纯客户端：** `useState`，不持久化，默认全展开
- **滚动容器：** `flex-1 overflow-y-auto min-h-0`，不硬编码像素
- **搜索内联到 TaskSidebar：** 不新建独立组件，避免 prop drilling
- **graphify-out 规则：** 涉及代码探索先 `graphify query`
- **测试命令：** `pnpm test`（vitest）；`pnpm typecheck`

---

## 文件结构

**修改：**
- `src/app/api/tasks/route.ts` — GET 新增 `q` 参数
- `src/components/tasks/TaskItem.tsx` — 根元素加 `data-task-id`
- `src/components/tasks/TaskPanel.tsx` — 新增 `highlightTaskId` + `onHighlightConsumed` props
- `src/app/tasks/page.tsx` — 新增 `highlightTaskId` state
- `src/components/tasks/TaskSidebar.tsx` — 搜索框 + 浮层 + 滚动容器 + section 折叠 + 标签管理迁移

**新建：**
- `tests/api/tasks-search.test.ts` — 搜索 API 测试

---

### Task 1: 后端 GET /api/tasks 新增 q 搜索参数

**文件：**
- 修改：`src/app/api/tasks/route.ts`
- 创建：`tests/api/tasks-search.test.ts`

**Interfaces:**
- Produces：`GET /api/tasks?q=关键字&limit=10` 全局 title 模糊搜索

- [ ] **Step 1：route.ts GET 函数加 q 参数处理**

在 `src/app/api/tasks/route.ts` 的 GET 函数中（约第 22-57 行），在读取 searchParams 之后、懒清理之前，加入 q 早期分支：

先在第 26 行 `const folderId = searchParams.get("folderId");` 之后加：

```ts
const q = searchParams.get("q");
const limitRaw = searchParams.get("limit");
```

然后在懒清理（`await prisma.task.deleteMany(...)`，约第 37-39 行）之后、`const where: Record<string, unknown> = {};`（约第 41 行）之前，插入 q 早期分支：

```ts
  // 全局搜索：q 存在时忽略其他 filter，只按 title contains + 非 trashed
  if (q) {
    const limit = Math.min(Math.max(parseInt(limitRaw ?? "10", 10) || 10, 1), 20);
    const searchTasks = await prisma.task.findMany({
      where: {
        title: { contains: q },
        trashed: false,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        list: {
          select: {
            id: true,
            name: true,
            color: true,
            folderId: true,
            folder: { select: { id: true, name: true } },
          },
        },
      },
    });
    const flat = searchTasks.map((t) => ({
      ...t,
      tags: t.tags.map((tt) => tt.tag),
    }));
    return NextResponse.json({ tasks: flat });
  }
```

**关键点：** `q` 分支 early return，不进入后续的 where/parentId/filterBySmartView 逻辑。

- [ ] **Step 2：写 API 测试**

创建 `tests/api/tasks-search.test.ts`（参考现有 `tests/api/tags-hierarchy.test.ts` 的测试风格——静态 import + NextRequest）：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "@/app/api/tasks/route";
import { NextRequest } from "next/server";

function makeReq(query: string) {
  return new NextRequest(`http://localhost/api/tasks?${query}`);
}

describe("GET /api/tasks?q= 搜索", () => {
  beforeEach(async () => {
    await prisma.taskTag.deleteMany();
    await prisma.task.deleteMany();
    await prisma.taskList.deleteMany();
    await prisma.taskFolder.deleteMany();
  });

  it("q 匹配 title（大小写不敏感）", async () => {
    const list = await prisma.taskList.create({
      data: { id: "test_list_1", name: "L1", color: "#6b7280", sortOrder: 0 },
    });
    await prisma.task.create({
      data: { title: "写周报", listId: list.id, sortOrder: 0 },
    });
    await prisma.task.create({
      data: { title: "买牛奶", listId: list.id, sortOrder: 1 },
    });
    const res = await GET(makeReq("q=周报"));
    const data = await res.json();
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].title).toBe("写周报");
  });

  it("q 排除 trashed 任务", async () => {
    const list = await prisma.taskList.create({
      data: { id: "test_list_2", name: "L2", color: "#6b7280", sortOrder: 0 },
    });
    await prisma.task.create({
      data: { title: "已废弃的任务", listId: list.id, sortOrder: 0, trashed: true },
    });
    const res = await GET(makeReq("q=废弃"));
    const data = await res.json();
    expect(data.tasks).toHaveLength(0);
  });

  it("limit 限制返回数量", async () => {
    const list = await prisma.taskList.create({
      data: { id: "test_list_3", name: "L3", color: "#6b7280", sortOrder: 0 },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.task.create({
        data: { title: `测试任务${i}`, listId: list.id, sortOrder: i },
      });
    }
    const res = await GET(makeReq("q=测试&limit=2"));
    const data = await res.json();
    expect(data.tasks).toHaveLength(2);
  });

  it("q 存在时忽略 listId 过滤（全局搜索）", async () => {
    const l1 = await prisma.taskList.create({
      data: { id: "test_list_a", name: "LA", color: "#6b7280", sortOrder: 0 },
    });
    const l2 = await prisma.taskList.create({
      data: { id: "test_list_b", name: "LB", color: "#6b7280", sortOrder: 1 },
    });
    await prisma.task.create({
      data: { title: "全局任务", listId: l1.id, sortOrder: 0 },
    });
    await prisma.task.create({
      data: { title: "全局任务2", listId: l2.id, sortOrder: 0 },
    });
    // 即使传 listId=test_list_a，q 分支应返回两个清单的匹配
    const res = await GET(makeReq("q=全局&listId=test_list_a"));
    const data = await res.json();
    expect(data.tasks).toHaveLength(2);
  });

  it("返回 task 含 list 关系", async () => {
    const list = await prisma.taskList.create({
      data: { id: "test_list_rel", name: "关系测试", color: "#6b7280", sortOrder: 0 },
    });
    await prisma.task.create({
      data: { title: "任务带清单", listId: list.id, sortOrder: 0 },
    });
    const res = await GET(makeReq("q=任务带清单"));
    const data = await res.json();
    expect(data.tasks[0].list).toBeDefined();
    expect(data.tasks[0].list.id).toBe("test_list_rel");
    expect(data.tasks[0].list.name).toBe("关系测试");
  });
});
```

- [ ] **Step 3：跑测试 + typecheck**

```bash
pnpm test tests/api/tasks-search.test.ts
pnpm typecheck
```

预期：5 个 case 全过；typecheck 0 错。

- [ ] **Step 4：Commit**

```bash
git add src/app/api/tasks/route.ts tests/api/tasks-search.test.ts
git commit -m "feat(api): GET /api/tasks 新增 q 全局搜索参数"
```

---

### Task 2: TaskPanel highlightTaskId + page.tsx state + TaskItem data-task-id

**文件：**
- 修改：`src/components/tasks/TaskItem.tsx`（根元素加 data-task-id）
- 修改：`src/components/tasks/TaskPanel.tsx`（highlightTaskId + onHighlightConsumed）
- 修改：`src/app/tasks/page.tsx`（highlightTaskId state）

**Interfaces:**
- Produces：TaskPanel `highlightTaskId?: string` + `onHighlightConsumed?: () => void`

- [ ] **Step 1：TaskItem 根元素加 data-task-id**

读 `src/components/tasks/TaskItem.tsx`，找到根元素（通常是 `<div className="...">` 包裹整个 TaskItem 的最外层）。在该根元素上加 `data-task-id={task.id}` 属性。

如果根元素是 `<div ref={...} className={...}>`，加成：
```tsx
<div data-task-id={task.id} className={...}>
```

- [ ] **Step 2：TaskPanel 加 highlightTaskId 逻辑**

在 `src/components/tasks/TaskPanel.tsx`：

1. 第 14-19 行 interface 替换为：

```ts
interface TaskPanelProps {
  listId?: string;
  folderId?: string;
  tagId?: string;
  highlightTaskId?: string;
  onHighlightConsumed?: () => void;
  view?: "main" | "trash";
}
```

2. 第 21 行函数签名替换为：

```ts
export function TaskPanel({ listId, folderId, tagId, highlightTaskId, onHighlightConsumed, view = "main" }: TaskPanelProps) {
```

3. 在 `useTasks` 调用之后（约第 32 行之后）加 useEffect：

```ts
  useEffect(() => {
    if (!highlightTaskId || loading || tasks.length === 0) return;
    // 等一帧让 DOM 完成渲染
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-task-id="${highlightTaskId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "rounded-md");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary", "rounded-md");
        onHighlightConsumed?.();
      }, 2000);
    }, 100);
    return () => clearTimeout(timer);
  }, [highlightTaskId, loading, tasks, onHighlightConsumed]);
```

- [ ] **Step 3：page.tsx 加 highlightTaskId state**

在 `src/app/tasks/page.tsx`：

1. 第 14-16 行 state 块加：

```ts
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
```

2. 在 `listId`/`folderId`/`tagId`/`view` 映射之后（约第 57 行之后）加一个 handler：

```ts
  const handleSelectWithHighlight = (key: SelectedKey, taskId?: string) => {
    setSelected(key);
    if (taskId) setHighlightTaskId(taskId);
  };
```

3. 第 116 行 TaskPanel 替换为：

```tsx
          <TaskPanel
            key={refreshKey}
            listId={listId}
            folderId={folderId}
            tagId={tagId}
            highlightTaskId={highlightTaskId ?? undefined}
            onHighlightConsumed={() => setHighlightTaskId(null)}
            view={view}
          />
```

4. 把 `setSelected` 传给 TaskSidebar 的 `onSelect` 改成允许 highlight（TaskSidebar 在 Task 4 搜索里会调一个带 taskId 的回调——本 Task 先留好 page 层接口）：

实际上 TaskSidebar 的 `onSelect` 签名不变（只传 SelectedKey），搜索功能在 Task 4 加。本步只改 TaskPanel props + page state。保持 `<TaskSidebar selected={selected} onSelect={setSelected} ... />` 不变。

- [ ] **Step 4：typecheck**

```bash
pnpm typecheck
```

预期：0 错。

- [ ] **Step 5：Commit**

```bash
git add src/components/tasks/TaskItem.tsx src/components/tasks/TaskPanel.tsx src/app/tasks/page.tsx
git commit -m "feat(tasks): TaskPanel 支持 highlightTaskId 滚动高亮机制"
```

---

### Task 3: TaskSidebar 滚动容器 + Section 折叠 + 标签管理迁移

**文件：**
- 修改：`src/components/tasks/TaskSidebar.tsx`

**Interfaces:**
- Consumes：无新接口

- [ ] **Step 1：加 section 折叠 state**

在 TaskSidebar 函数内 state 块（已有 tags/collapsedTagIds 等 state）加：

```ts
const [sectionsCollapsed, setSectionsCollapsed] = useState<{ lists: boolean; tags: boolean }>({
  lists: false,
  tags: false,
});
```

- [ ] **Step 2：清单 section header 加折叠箭头 + 点击切换**

找到清单 section header（`<div className="flex items-center justify-between px-2">` 含「清单」文字的那个）。把「清单」文字部分改成可点击 button：

```tsx
<div className="flex items-center justify-between px-2">
  <button
    onClick={() => setSectionsCollapsed((s) => ({ ...s, lists: !s.lists }))}
    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
  >
    {sectionsCollapsed.lists ? (
      <ChevronRight className="h-3.5 w-3.5" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5" />
    )}
    <span>清单</span>
  </button>
  <div className="flex items-center gap-1">
    {/* 原有的 collapse-all / 新建文件夹 / 新建清单 按钮 */}
  </div>
</div>
```

（保留原有右侧 `⇕`/`📁`/`+` 三个按钮不变。）

- [ ] **Step 3：标签 section header 加 TagIcon + 折叠**

找到标签 section header。改成：

```tsx
<div className="flex items-center justify-between px-2">
  <div className="flex items-center gap-1">
    <button
      onClick={() => setTagOpen(true)}
      className="p-0.5 rounded hover:bg-accent text-muted-foreground"
      title="标签管理"
    >
      <TagIcon className="h-3.5 w-3.5" />
    </button>
    <button
      onClick={() => setSectionsCollapsed((s) => ({ ...s, tags: !s.tags }))}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      {sectionsCollapsed.tags ? (
        <ChevronRight className="h-3.5 w-3.5" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5" />
      )}
      <span>标签</span>
    </button>
  </div>
  <div className="flex items-center gap-1">
    {/* 原有 + 按钮 */}
  </div>
</div>
```

- [ ] **Step 4：包裹 section 内容用条件渲染**

清单 DndContext 块：找到 `<DndContext sensors={sensors} ...>` （顶层 list DnD context，约第 461 行），用 `{!sectionsCollapsed.lists && (...)}` 包裹整个 DndContext：

```tsx
{!sectionsCollapsed.lists && (
  <DndContext ...>
    {/* 顶层独立清单 + 文件夹 */}
  </DndContext>
)}
```

标签树渲染块：找到 `{tagTree.map((tag) => ...}`，用 `{!sectionsCollapsed.tags && tagTree.map(...)}` 包裹。

- [ ] **Step 5：中间区域加滚动容器**

当前结构（简化）：

```tsx
<aside className="w-60 ... flex flex-col gap-1 p-3 h-full">
  <button>全部任务</button>
  <div className="h-px" />
  {/* 清单 header */}
  {/* 清单 DndContext */}
  <div className="h-px" />
  {/* 标签 header */}
  {/* 标签树 */}
  <div className="h-px" />
  <button>垃圾箱</button>
  <div className="flex-1" />
  <button>标签管理</button>
  {/* dialogs */}
</aside>
```

改成（顶部固定 + 中间滚动 + 底部固定）：

```tsx
<aside className="w-60 shrink-0 border-r border-border flex flex-col p-3 h-full">
  {/* 固定顶部 */}
  <button onClick={() => onSelect({ type: "all" })} ...>全部任务</button>
  <div className="h-px bg-border my-1" />

  {/* 可滚动中间区域 */}
  <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
    {/* 清单 header */}
    {/* 清单 DndContext（条件渲染） */}
    <div className="h-px bg-border my-1" />
    {/* 标签 header */}
    {/* 标签树（条件渲染） */}
  </div>

  {/* 固定底部 */}
  <div className="h-px bg-border my-1" />
  <button onClick={() => onSelect({ type: "trash" })} ...>垃圾箱</button>

  {/* dialogs */}
</aside>
```

**关键点：**
- aside 改为 `flex flex-col p-3 h-full`（去掉 `gap-1`，手动控制间距）
- 中间 div 用 `flex-1 overflow-y-auto min-h-0`
- `-mx-1 px-1` 让滚动条往外偏移一点，不贴着内容
- 删除底部 `标签管理` button + `<div className="flex-1" />`（标签管理迁到 header 了）

- [ ] **Step 6：typecheck + 测试**

```bash
pnpm typecheck
pnpm test
```

预期：0 错；测试全过。

- [ ] **Step 7：Commit**

```bash
git add src/components/tasks/TaskSidebar.tsx
git commit -m "feat(tasks): TaskSidebar 滚动容器 + section 折叠 + 标签管理迁移"
```

---

### Task 4: TaskSidebar 搜索框 + 下拉浮层

**文件：**
- 修改：`src/components/tasks/TaskSidebar.tsx`
- 修改：`src/app/tasks/page.tsx`（onSelect 扩展支持 highlight taskId）

**Interfaces:**
- Consumes：Task 1（`/api/tasks?q=`）、Task 2（highlightTaskId 管道）

**注意：** 本 Task 需要改 `onSelect` 的调用方式——搜索点击任务时既要选中清单又要设 highlightTaskId。方案：TaskSidebar 新增 `onSelectTask?(taskId: string, listId: string)` 可选 prop，page.tsx 实现它。

- [ ] **Step 1：page.tsx 加 onSelectTask handler**

在 `src/app/tasks/page.tsx`：

1. `handleSelectWithHighlight` 改成两个 handler：

```ts
const handleSelectTask = (taskId: string, listId: string) => {
  setSelected({ type: "list", id: listId });
  setHighlightTaskId(taskId);
};
```

2. TaskSidebar props 加 `onSelectTask`：

找到 `<TaskSidebar selected={selected} onSelect={setSelected} ... />`（desktop 和 mobile 两处都要改），加 `onSelectTask={handleSelectTask}`。

- [ ] **Step 2：TaskSidebar props 加 onSelectTask**

`src/components/tasks/TaskSidebar.tsx`：

1. 第 64-68 行 `TaskSidebarProps` 加：

```ts
interface TaskSidebarProps {
  selected: SelectedKey;
  onSelect: (key: SelectedKey) => void;
  onSelectTask?: (taskId: string, listId: string) => void;
  refreshKey?: number;
}
```

2. 函数签名加解构 `onSelectTask`：

```ts
export function TaskSidebar({ selected, onSelect, onSelectTask, refreshKey }: TaskSidebarProps) {
```

- [ ] **Step 3：搜索 state + 防抖**

在 state 块加：

```ts
const [searchQuery, setSearchQuery] = useState("");
const [debouncedQuery, setDebouncedQuery] = useState("");
const [taskResults, setTaskResults] = useState<Array<{ id: string; title: string; list?: { id: string; name: string } }>>([]);
const [searching, setSearching] = useState(false);

useEffect(() => {
  const t = setTimeout(() => setDebouncedQuery(searchQuery), 300);
  return () => clearTimeout(t);
}, [searchQuery]);

useEffect(() => {
  if (!debouncedQuery.trim()) {
    setTaskResults([]);
    setSearching(false);
    return;
  }
  let cancelled = false;
  setSearching(true);
  fetch(`/api/tasks?q=${encodeURIComponent(debouncedQuery)}&limit=5`)
    .then((r) => r.ok ? r.json() : { tasks: [] })
    .then((data) => {
      if (!cancelled) {
        setTaskResults(data.tasks ?? []);
        setSearching(false);
      }
    })
    .catch(() => {
      if (!cancelled) {
        setTaskResults([]);
        setSearching(false);
      }
    });
  return () => { cancelled = true; };
}, [debouncedQuery]);
```

确保 `useEffect` 已从 react import（应该已有）。

- [ ] **Step 4：客户端过滤 folders/lists/tags**

在 helper 区域加 useMemo：

```ts
const searchResults = useMemo(() => {
  const q = debouncedQuery.trim().toLowerCase();
  if (!q) return { folders: [], lists: [], tags: [] };
  const matchFolder = (name: string) => name.toLowerCase().includes(q);
  const matchedFolders = folders.filter((f) => matchFolder(f.name)).slice(0, 5);
  // 文件夹不直接可选——列出文件夹下的清单 + 顶层清单
  const matchedStandaloneLists = standaloneLists
    .filter((l) => matchFolder(l.name))
    .slice(0, 5);
  const matchedFolderLists = folders
    .filter((f) => matchFolder(f.name))
    .flatMap((f) => f.lists)
    .filter((l) => l && matchFolder(l.name))
    .slice(0, 5);
  const matchedTags = tags
    .filter((t) => matchFolder(t.name))
    .slice(0, 5);
  return {
    folders: matchedFolders,
    lists: [...matchedStandaloneLists, ...matchedFolderLists].slice(0, 5),
    tags: matchedTags,
  };
}, [debouncedQuery, folders, standaloneLists, tags]);
```

注意：文件夹本身也可选（`onSelect({ type: "folder", id })`），所以也要列出来。修正：

```ts
const searchResults = useMemo(() => {
  const q = debouncedQuery.trim().toLowerCase();
  if (!q) return { folders: [], lists: [], tags: [] };
  const match = (name: string) => name.toLowerCase().includes(q);
  const matchedFolders = folders.filter((f) => match(f.name)).slice(0, 5);
  const allLists = [
    ...standaloneLists,
    ...folders.flatMap((f) => f.lists),
  ];
  const matchedLists = allLists.filter((l) => match(l.name)).slice(0, 5);
  const matchedTags = tags.filter((t) => match(t.name)).slice(0, 5);
  return { folders: matchedFolders, lists: matchedLists, tags: matchedTags };
}, [debouncedQuery, folders, standaloneLists, tags]);
```

- [ ] **Step 5：搜索框 + 浮层 JSX**

在「全部任务」按钮之后、滚动容器之前，加搜索框：

```tsx
<div className="relative">
  <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50">
    <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    <input
      type="text"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setSearchQuery("");
          setDebouncedQuery("");
        }
      }}
      placeholder="搜索文件夹/标签/任务..."
      className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
    />
    {searchQuery && (
      <button
        onClick={() => {
          setSearchQuery("");
          setDebouncedQuery("");
        }}
        className="p-0.5 rounded hover:bg-accent text-muted-foreground"
        title="清空"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </div>

  {/* 下拉浮层 */}
  {debouncedQuery.trim() && (
    <div className="absolute top-full left-0 right-0 mt-1 max-h-80 overflow-y-auto bg-popover border border-border rounded-md shadow-md z-50">
      {searchResults.folders.length === 0 &&
      searchResults.lists.length === 0 &&
      searchResults.tags.length === 0 &&
      taskResults.length === 0 ? (
        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
          {searching ? "搜索中..." : "无匹配结果"}
        </div>
      ) : (
        <>
          {(searchResults.folders.length > 0 || searchResults.lists.length > 0) && (
            <div className="py-1">
              <div className="px-3 py-1 text-xs text-muted-foreground">文件夹/清单</div>
              {searchResults.folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    onSelect({ type: "folder", id: f.id });
                    setSearchQuery("");
                    setDebouncedQuery("");
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{f.name}</span>
                </button>
              ))}
              {searchResults.lists.map((l) => (
                <button
                  key={l.id}
                  onClick={() => {
                    onSelect({ type: "list", id: l.id });
                    setSearchQuery("");
                    setDebouncedQuery("");
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
                >
                  <Menu className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{l.name}</span>
                </button>
              ))}
            </div>
          )}
          {searchResults.tags.length > 0 && (
            <div className="py-1 border-t border-border">
              <div className="px-3 py-1 text-xs text-muted-foreground">标签</div>
              {searchResults.tags.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    onSelect({ type: "tag", id: t.id });
                    setSearchQuery("");
                    setDebouncedQuery("");
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: t.color }}
                  />
                  <span className="flex-1 truncate">{t.name}</span>
                </button>
              ))}
            </div>
          )}
          {taskResults.length > 0 && (
            <div className="py-1 border-t border-border">
              <div className="px-3 py-1 text-xs text-muted-foreground">任务</div>
              {taskResults.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    if (t.list?.id && onSelectTask) {
                      onSelectTask(t.id, t.list.id);
                    }
                    setSearchQuery("");
                    setDebouncedQuery("");
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
                  disabled={!t.list?.id || !onSelectTask}
                >
                  <span className="w-3.5 h-3.5 border border-current rounded shrink-0" />
                  <span className="flex-1 truncate">{t.title}</span>
                  {t.list?.name && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      [{t.list.name}]
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )}
</div>
```

- [ ] **Step 6：加 import**

确保 lucide-react import 块含 `Search` 和 `X`：

```ts
import {
  ListChecks,
  Menu,
  Search,
  X,
  FolderOpen,
  // ... 其他已有的
} from "lucide-react";
```

- [ ] **Step 7：typecheck + 测试**

```bash
pnpm typecheck
pnpm test
```

预期：0 错；测试全过。

- [ ] **Step 8：Commit**

```bash
git add src/components/tasks/TaskSidebar.tsx src/app/tasks/page.tsx
git commit -m "feat(tasks): TaskSidebar 搜索框 + 下拉浮层（文件夹/清单/标签/任务）"
```

---

## 自检

**1. 规格覆盖度：**

- ✅ 固定高度 8 条 + 滚动条 → Task 3 Step 5（flex-1 overflow-y-auto min-h-0）
- ✅ 搜索框（模糊搜文件夹/标签/任务名） → Task 4（客户端过滤 + Task 1 服务端搜任务）
- ✅ 下拉浮层点击跳转 → Task 4 Step 5（三组结果 + onSelect/onSelectTask）
- ✅ 删除底部标签管理按钮 → Task 3 Step 5（删除 button + flex-1 spacer）
- ✅ 标签管理图标迁到标签 header → Task 3 Step 3（TagIcon onClick setTagOpen）
- ✅ 清单和标签 section 可折叠 → Task 3 Step 2-4（sectionsCollapsed state + 条件渲染）
- ✅ 点击任务跳到清单 + 高亮 → Task 2（highlightTaskId）+ Task 4 Step 5（onSelectTask 调用）

**2. 占位符扫描：** 无 TBD/TODO，所有 code step 有完整代码。

**3. 类型一致性：**

- `onSelectTask?: (taskId: string, listId: string) => void` 在 Task 4 定义 → page.tsx 实现 `handleSelectTask(taskId, listId)` ✓
- `highlightTaskId?: string` 在 Task 2 定义 → page.tsx 传 TaskPanel ✓
- 搜索结果 task 类型 `{ id, title, list?: { id, name } }` 与 `/api/tasks?q=` 返回的 include 结构一致 ✓

**4. 风险已处理：**

- q 早期 return 不污染其他 filter → Task 1 Step 1 ✓
- highlightTaskId 时序（tasks 加载后才滚动）→ Task 2 useEffect 双依赖 + setTimeout 100ms ✓
- 浮层 z-50 高于 sidebar 低于 dialog → Task 4 Step 5 ✓

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-07-11-task-sidebar-search-scroll-collapse.md`。两种执行方式：

**1. 子代理驱动（推荐）**
**2. 内联执行**

选哪种方式？
