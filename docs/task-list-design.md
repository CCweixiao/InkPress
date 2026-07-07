# 待办任务列表功能设计文档

> 范围：InkPress 桌面端新增「待办任务」模块，提供类滴答清单/Notion 风格的任务跟踪能力。
> 目标：在写作/知识管理工具中内嵌轻量级任务管理，帮助用户跟踪与创作相关的待办事项（如选题计划、稿件进度、修改备忘等），无需在多个应用间切换。
> 参考：滴答清单（TickTick）、Notion Task/Database、Apple Reminders。

---

## 0. 设计背景

### 为什么 InkPress 需要任务列表？

InkPress 定位为"AI 驱动的写作创作平台"。创作者的日常工作流中，任务管理与写作天然关联：

- **选题管理**：维护"想写什么"清单，标记优先级、截止日
- **稿件进度**：跟踪"初稿→修改→定稿→发布"的多阶段流程
- **修改备忘**：记录审稿反馈、待改点
- **发布计划**：关联具体文章，设定发布时间节点

现有的"空间(Space) + 文章(Article)"结构缺少对"待做但未开始"和"进行中流程"的显式表达。

### 设计原则

1. **轻量内嵌**：不做全功能项目管理工具，聚焦"个人创作者 + 小团队"的任务场景
2. **与文章打通**：任务可关联文章，文章内可嵌入/引用任务
3. **渐进披露**：简单场景只需标题+勾选；复杂场景可展开子任务、标签、日期等
4. **本地优先**：数据存于本地 SQLite，与现有 Prisma 模型体系一致
5. **键盘友好**：支持快捷键快速创建、导航、完成，符合写作者工作习惯

---

## 1. 功能入口

### 1.1 侧边栏一级入口

在现有左侧导航栏中，于「我的文章」和「素材库」之间新增一级入口：

```
┌─────────────────┐
│ 🏠 我的文章      │
│ ✅ 待办任务      │  ← 新增
│ 📦 素材库        │
│ 🗑️ 回收站        │
│ ⚙️ 设置          │
└─────────────────┘
```

- 图标：Lucide `CheckSquare` 或 `ListTodo`
- 右侧显示未完成任务计数徽章（如 `3`）
- 点击进入任务列表主页面

### 1.2 快速创建入口

| 入口 | 触发方式 | 行为 |
|------|----------|------|
| 全局快捷键 | `Cmd/Ctrl + Shift + T` | 弹出快速创建浮窗（类滴答清单快速添加） |
| 编辑器内 | 选中文本 → 右键 → "创建待办" | 将选中文本作为任务标题，自动关联当前文章 |
| 任务列表页 | 页面底部输入框 / `Enter` 快捷键 | 直接在当前列表/清单下新建任务 |
| 命令面板 | `Cmd/Ctrl + K` → "新建任务" | 统一搜索/命令入口 |

### 1.3 文章-任务联动入口

- 文章详情页侧边栏显示"关联任务"区块
- 文章列表可按"有待办"筛选

---

## 2. 数据模型

### 2.1 核心模型（Prisma Schema）

```prisma
// ===== 任务清单（任务的分组容器） =====
model TaskList {
  id          String   @id @default(cuid())
  name        String   // "选题池"、"本周待办"、"发布计划"
  icon        String?  // emoji 或 lucide 图标名
  color       String?  // 清单主题色 hex
  sortOrder   Int      @default(0)
  isArchived  Boolean  @default(false)
  viewMode    String   @default("LIST") // LIST | BOARD | CALENDAR
  tasks       Task[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([isArchived, sortOrder])
}

// ===== 任务 =====
model Task {
  id            String       @id @default(cuid())
  title         String       // 任务标题
  content       String?      // 任务描述/笔记（Markdown）
  status        String       @default("TODO") // TODO | IN_PROGRESS | DONE | CANCELLED
  priority      String       @default("NONE") // NONE | LOW | MEDIUM | HIGH | URGENT
  dueDate       DateTime?    // 截止日期
  dueTime       String?      // 截止时间 "HH:mm"（可选精确到分钟）
  startDate     DateTime?    // 开始日期
  completedAt   DateTime?    // 完成时间
  sortOrder     Int          @default(0) // 列表内排序
  isAllDay      Boolean      @default(true)
  // 层级关系
  parentId      String?      // 父任务 ID（子任务机制）
  parent        Task?        @relation("TaskSubtasks", fields: [parentId], references: [id], onDelete: Cascade)
  subtasks      Task[]       @relation("TaskSubtasks")
  // 所属清单
  taskListId    String?
  taskList      TaskList?    @relation(fields: [taskListId], references: [id], onDelete: SetNull)
  // 标签
  tags          TaskTag[]
  // 文章关联
  articleLinks  TaskArticleLink[]
  // 重复规则
  repeatRule    String?      // iCal RRULE 格式（如 "FREQ=DAILY;INTERVAL=1"）
  // 提醒
  reminders     TaskReminder[]
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  @@index([taskListId, status, sortOrder])
  @@index([status, dueDate])
  @@index([parentId])
  @@index([priority, status])
}

// ===== 标签 =====
model TaskTag {
  id        String   @id @default(cuid())
  name      String   @unique // "选题"、"紧急"、"灵感"
  color     String?  // hex 色值
  tasks     Task[]
  createdAt DateTime @default(now())
}

// ===== 任务-文章关联 =====
model TaskArticleLink {
  id        String   @id @default(cuid())
  taskId    String
  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  articleId String   // 关联的文章 ID（本地文章系统的 ID）
  note      String?  // 关联说明
  createdAt DateTime @default(now())

  @@unique([taskId, articleId])
  @@index([articleId])
}

// ===== 提醒 =====
model TaskReminder {
  id         String   @id @default(cuid())
  taskId     String
  task       Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  triggerAt  DateTime // 绝对触发时间
  type       String   @default("NOTIFICATION") // NOTIFICATION | EMAIL（未来）
  firedAt    DateTime?
  createdAt  DateTime @default(now())

  @@index([triggerAt, firedAt])
  @@index([taskId])
}
```

### 2.2 模型说明

- **TaskList**：类似滴答清单的"清单"概念，任务的容器。支持不同视图模式
- **Task**：核心实体，支持子任务（parentId 自引用），最多 2 层嵌套（与滴答清单一致）
- **TaskTag**：标签系统，多对多关系，用于跨清单筛选
- **TaskArticleLink**：InkPress 特色——任务与文章的双向关联
- **TaskReminder**：提醒记录，桌面端通过 Electron Notification API 触发

---

## 3. 页面布局

### 3.1 任务列表主页面

```
┌──────────────────────────────────────────────────────────────────────┐
│ ┌─ 侧栏（清单导航）─┐  ┌─────── 主内容区 ────────────────────────┐  │
│ │                    │  │                                          │  │
│ │ 📥 收集箱          │  │  收集箱                    [+] ☰ ⋮      │  │
│ │ 📅 今天            │  │  ─────────────────────────────────       │  │
│ │ 📆 最近 7 天       │  │                                          │  │
│ │ 🏷️ 标签            │  │  □ 完成产品介绍文章初稿        🔴 明天   │  │
│ │                    │  │  □ 收集竞品分析素材            🟡 周五   │  │
│ │ ── 我的清单 ──     │  │    └ □ 截图对比表格                      │  │
│ │ 📝 选题池          │  │    └ □ 撰写分析要点                      │  │
│ │ 📤 发布计划        │  │  □ 规划下周公众号主题                    │  │
│ │ 💡 灵感记录        │  │  ☑ 修改"AI写作"文章错别字    ✓ 已完成   │  │
│ │                    │  │                                          │  │
│ │ [+ 新建清单]       │  │  ─ 已完成 (3) ──────────────────         │  │
│ │                    │  │  ☑ 确定本月写作主题                      │  │
│ │                    │  │                                          │  │
│ │                    │  │  ┌─────────────────────────────────┐     │  │
│ │                    │  │  │ + 添加任务...          Enter ↵  │     │  │
│ │                    │  │  └─────────────────────────────────┘     │  │
│ └────────────────────┘  └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 智能视图

| 视图 | 说明 | 筛选规则 |
|------|------|----------|
| **收集箱** | 未分配清单的任务，默认落地点 | `taskListId IS NULL AND status != DONE` |
| **今天** | 今日到期 + 今日已完成 | `dueDate = today OR (completedAt IS today)` |
| **最近 7 天** | 未来一周时间轴视图 | `dueDate BETWEEN today AND today+7` |
| **标签** | 按标签分组浏览 | 按 tag 聚合 |

### 3.3 任务详情面板（右侧抽屉 / 弹窗）

点击任务行展开详情，采用右侧滑出抽屉式（参考 Notion 侧栏编辑）：

```
┌─────────────────────────────────┐
│ × 关闭                          │
│                                 │
│ □ 完成产品介绍文章初稿          │  ← 标题可编辑
│                                 │
│ 清单：发布计划          ▾       │
│ 优先级：🔴 高            ▾       │
│ 截止日：2024-03-15      📅      │
│ 标签：[选题] [紧急]     +       │
│ 重复：不重复            ▾       │
│ 提醒：截止前 1 小时     ▾       │
│                                 │
│ ── 关联文章 ──                  │
│ 📄 产品介绍初稿.md      🔗      │
│ [+ 关联文章]                    │
│                                 │
│ ── 子任务 ──                    │
│ □ 整理产品功能列表              │
│ □ 撰写使用场景                  │
│ ☑ 收集用户反馈                  │
│ [+ 添加子任务]                  │
│                                 │
│ ── 备注 ──                      │
│ ┌─────────────────────────┐    │
│ │ Markdown 编辑区域...     │    │
│ └─────────────────────────┘    │
│                                 │
│ 创建于 3月10日 · 更新于 3月12日 │
└─────────────────────────────────┘
```

### 3.4 多视图模式

每个清单可切换三种视图：

#### 列表视图（默认）
- 线性排列，支持拖拽排序
- 子任务缩进显示
- 已完成任务折叠到底部

#### 看板视图（Board）
- 列 = 任务状态（TODO / IN_PROGRESS / DONE）
- 或按自定义字段分列（如优先级）
- 拖拽卡片切换状态

```
┌─── 待办 ───┐  ┌── 进行中 ──┐  ┌── 已完成 ──┐
│ ┌─────────┐ │  │ ┌─────────┐ │  │ ┌─────────┐ │
│ │ 任务 A  │ │  │ │ 任务 C  │ │  │ │ 任务 E  │ │
│ │ 🔴 明天  │ │  │ │ 🟡 周五  │ │  │ │ ✓ 昨天  │ │
│ └─────────┘ │  │ └─────────┘ │  │ └─────────┘ │
│ ┌─────────┐ │  │             │  │             │
│ │ 任务 B  │ │  │             │  │             │
│ └─────────┘ │  │             │  │             │
└─────────────┘  └─────────────┘  └─────────────┘
```

#### 日历视图
- 月/周切换
- 任务按 dueDate 定位到日格
- 支持拖拽调整日期

---

## 4. 交互设计

### 4.1 快速创建

**内联创建（列表底部）**：
1. 聚焦底部输入框（或按 `N` 快捷键）
2. 输入标题，按 `Enter` 创建并继续
3. 按 `Tab` 可快速设定截止日（自然语言解析："明天"、"周五"、"3月20日"）
4. 按 `!` 设定优先级（`!1` = 紧急，`!2` = 高，`!3` = 中）
5. 按 `#` 添加标签
6. 按 `Esc` 或点击其他区域结束

**全局快速添加浮窗**（`Cmd+Shift+T`）：
```
┌──────────────────────────────────────────────┐
│ + 添加任务                                    │
│ ┌──────────────────────────────────────────┐ │
│ │ 写完竞品分析报告 #选题 !2 明天            │ │
│ └──────────────────────────────────────────┘ │
│ 清单：[发布计划 ▾]  📅 明天  🔴 高          │
│                              [添加] [取消]   │
└──────────────────────────────────────────────┘
```

### 4.2 自然语言日期解析

参考滴答清单的智能日期识别：
- "明天" → tomorrow
- "下周一" → next Monday
- "3月20日" → 2024-03-20
- "每周五" → RRULE: FREQ=WEEKLY;BYDAY=FR
- "3天后" → today + 3 days

### 4.3 拖拽交互

| 操作 | 触发 | 效果 |
|------|------|------|
| 排序 | 拖拽任务行 | 更新 sortOrder |
| 移动到清单 | 拖拽到左侧清单 | 更新 taskListId |
| 创建子任务 | 拖拽并缩进（向右） | 设置 parentId |
| 提升层级 | 拖拽并突出（向左） | 清除 parentId |
| 日历调日期 | 日历视图拖拽 | 更新 dueDate |
| 看板换状态 | 拖拽到另一列 | 更新 status |

### 4.4 键盘快捷键

| 快捷键 | 作用域 | 功能 |
|--------|--------|------|
| `Cmd/Ctrl + Shift + T` | 全局 | 打开快速添加浮窗 |
| `N` | 任务列表页 | 新建任务（聚焦输入框） |
| `Enter` | 任务行聚焦 | 打开任务详情 |
| `Space` | 任务行聚焦 | 切换完成状态 |
| `Tab` | 任务行聚焦 | 缩进为子任务 |
| `Shift + Tab` | 子任务聚焦 | 提升为同级任务 |
| `↑ / ↓` | 任务列表 | 导航 |
| `Cmd + ↑/↓` | 任务列表 | 移动任务顺序 |
| `Cmd + D` | 任务行聚焦 | 设置截止日 |
| `Cmd + Shift + 1-4` | 任务行聚焦 | 设置优先级 |
| `Delete / Backspace` | 任务行聚焦 | 删除任务（二次确认） |

### 4.5 完成动效

参考滴答清单的满足感设计：
- 勾选时：checkbox 填充动画 + 标题划线 + 轻微弹跳
- 全部完成时：清单标题旁显示 🎉 confetti 微动效（可在设置中关闭）
- 已完成任务 0.3s 后滑入"已完成"折叠区

---

## 5. AI 集成

### 5.1 AI 辅助任务创建

在写作 Agent 对话中支持自然语言创建任务：
- 用户说"帮我建一个任务：下周五前完成竞品分析" → Agent 调用 `create_task` 工具
- Agent 写作完成后，自动建议关联任务（如"是否将此文章标记为已完成？"）

### 5.2 AI 任务分解

选中复杂任务 → 右键"AI 分解子任务"：
- Agent 根据任务标题+描述，建议 3-7 个子任务
- 用户确认后批量创建

### 5.3 写作建议关联

Agent 生成文章大纲时，可同时为每个章节创建对应子任务，方便分段完成长文。

---

## 6. 技术实现要点

### 6.1 前端组件结构

```
src/
├── app/tasks/                    # 任务列表页面路由
│   ├── page.tsx                  # 主页面（SSR 数据加载）
│   └── [listId]/page.tsx         # 特定清单页面
├── components/tasks/
│   ├── TaskListPage.tsx          # 主页面客户端组件
│   ├── TaskListSidebar.tsx       # 左侧清单导航
│   ├── TaskListView.tsx          # 列表视图
│   ├── TaskBoardView.tsx         # 看板视图
│   ├── TaskCalendarView.tsx      # 日历视图
│   ├── TaskItem.tsx              # 单条任务行
│   ├── TaskDetail.tsx            # 任务详情抽屉
│   ├── TaskQuickAdd.tsx          # 快速添加输入框
│   ├── TaskQuickAddDialog.tsx    # 全局快速添加浮窗
│   ├── TaskDatePicker.tsx        # 日期选择器（含自然语言）
│   ├── TaskPrioritySelect.tsx    # 优先级选择器
│   ├── TaskTagSelect.tsx         # 标签选择器
│   └── TaskArticleLink.tsx       # 文章关联组件
└── lib/tasks/
    ├── task-service.ts           # CRUD 服务层
    ├── task-date-parser.ts       # 自然语言日期解析
    ├── task-sort.ts              # 排序逻辑
    └── task-reminder.ts          # 提醒调度（Electron）
```

### 6.2 数据流

```
用户操作 → React State (optimistic update)
        → API Route / Server Action
        → Prisma → SQLite
        → 返回确认 / 冲突处理
```

- 采用乐观更新（optimistic update）保证操作流畅
- 拖拽排序使用 `@dnd-kit/core`（已在项目依赖生态中）
- 日历视图考虑使用 `react-big-calendar` 或自研轻量日历

### 6.3 提醒机制（Electron）

```typescript
// electron/main 中注册定时检查
setInterval(async () => {
  const dueReminders = await prisma.taskReminder.findMany({
    where: {
      triggerAt: { lte: new Date() },
      firedAt: null,
    },
    include: { task: true },
  });
  for (const reminder of dueReminders) {
    new Notification({
      title: '任务提醒',
      body: reminder.task.title,
    }).show();
    await prisma.taskReminder.update({
      where: { id: reminder.id },
      data: { firedAt: new Date() },
    });
  }
}, 60_000); // 每分钟检查一次
```

### 6.4 与现有系统集成点

| 集成点 | 方式 | 说明 |
|--------|------|------|
| 侧边栏导航 | 修改 `components/common/Sidebar.tsx` | 新增"待办任务"入口 |
| 编辑器右键菜单 | 扩展编辑器 context menu | "从选中文本创建任务" |
| AI Agent 工具 | 新增 `create_task` / `list_tasks` 工具定义 | Agent 可操作任务 |
| 文章详情侧栏 | 新增 `TaskArticleSection` 组件 | 显示关联任务 |
| 全局搜索 | 扩展 `Cmd+K` 命令面板 | 搜索任务、跳转 |

---

## 7. 分期实施计划

### Phase 1：核心 CRUD（MVP）

- [ ] 数据模型 migration
- [ ] 任务清单 CRUD（创建/重命名/删除/排序）
- [ ] 任务 CRUD（创建/编辑/完成/删除）
- [ ] 列表视图（含子任务缩进展示）
- [ ] 侧边栏入口 + 路由
- [ ] 快速创建输入框（内联）
- [ ] 优先级 + 截止日设置
- [ ] 拖拽排序

### Phase 2：智能视图 + 交互增强

- [ ] "今天" / "最近 7 天" 智能视图
- [ ] 标签系统
- [ ] 全局快速添加浮窗（`Cmd+Shift+T`）
- [ ] 自然语言日期解析
- [ ] 看板视图
- [ ] 完成动效
- [ ] 键盘快捷键全覆盖

### Phase 3：深度集成

- [ ] 任务-文章关联
- [ ] 日历视图
- [ ] 提醒系统（Electron Notification）
- [ ] AI 任务创建/分解工具
- [ ] 编辑器右键"创建待办"
- [ ] 重复任务规则

### Phase 4：高级特性（可选）

- [ ] 任务模板（如"新文章 checklist"）
- [ ] 统计面板（完成率、燃尽图）
- [ ] 番茄钟集成
- [ ] 导入/导出（兼容 TickTick CSV 格式）

---

## 8. 视觉风格参考

### 8.1 配色

- 优先级色彩系统（与滴答清单对齐）：
  - 🔴 紧急 `#EF4444` (red-500)
  - 🟠 高 `#F97316` (orange-500)
  - 🟡 中 `#EAB308` (yellow-500)
  - 🔵 低 `#3B82F6` (blue-500)
  - ⚪ 无 `transparent`

### 8.2 组件风格

- 任务行高度 36-40px，紧凑但可点击
- Checkbox 使用圆角方形（参考 Notion），完成态填充对应优先级颜色
- 悬浮显示快捷操作图标（日期、优先级、更多）
- 深色/浅色主题跟随系统设置（复用现有 `theme-mode.ts`）

### 8.3 动效

- 完成划线：`text-decoration: line-through` + `opacity: 0.5` 过渡 200ms
- 列表增删：Framer Motion `AnimatePresence` + `layout` 动画
- 拖拽预览：半透明 + 轻微缩放 (0.98) + 投影增强

---

## 9. 开放问题

| # | 问题 | 待定方案 | 决策状态 |
|---|------|----------|----------|
| 1 | 是否支持多人协作任务分配？ | Phase 1 不做，未来考虑通过 inkpress-service 用户系统扩展 | 暂不支持 |
| 2 | 任务数据是否同步到 inkpress-service？ | 本地优先，未来可选同步（类似 Apple Reminders 的 iCloud 同步） | 暂仅本地 |
| 3 | 子任务最大嵌套层级？ | 2 层（与滴答清单一致），避免过度复杂 | 2 层 |
| 4 | 已完成任务保留时长？ | 永久保留，支持按时间段归档/清理 | 永久 |
| 5 | 是否支持任务评论？ | Phase 1 用"备注"字段代替，不做独立评论流 | 备注代替 |

---

## 10. 总结

本设计旨在为 InkPress 增加"轻量但够用"的任务跟踪能力，核心差异点在于：

1. **写作场景深度绑定**：任务可关联文章、从编辑器快速创建、Agent 辅助分解
2. **本地优先零配置**：延续 InkPress SQLite 单文件哲学，无需额外服务
3. **渐进式复杂度**：简单场景一行标题+勾选即可；复杂场景展开完整字段
4. **键盘驱动**：面向创作者的高效操作体验

后续待人工审阅确认后，进入 Phase 1 开发。
