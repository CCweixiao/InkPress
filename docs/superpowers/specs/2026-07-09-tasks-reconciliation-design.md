# 待办任务功能：现状 vs 设计差异与迁移决策

> **状态**：差异盘点 + 迁移选项分析（**不做最终决策**——本轮按用户要求只产出文档，是否迁移、如何迁移留给下一轮）。
> **读者**：未来要执行任务功能迁移的开发者（含 AI Agent）。
> **范围**：以 `main` 分支 `3f7173b9`（feat(tasks)）为现状基线，对照 `docs/task-list-design.md`（572 行，4 阶段计划）逐项比对。
> **生成日期**：2026-07-09。

---

## 0. 阅读指南

- 每项差异（ADR）使用固定结构：**现状 → 设计要求 → 迁移选项 → 利弊 → 推荐 → 理由**。
- "推荐"分两档：
  - 🟢 **强推荐**：下一轮应优先执行，理由充分、破坏性可控。
  - 🟡 **倾向推荐**：建议如此，但保留根据实际上线下调的可能。
- 工作量估算使用 T-shirt size：`S`（<1 天）、`M`（1-3 天）、`L`（>3 天）。
- 末尾 §6 给出**分阶段、可回退**的迁移路径，把所有 ADR 串成执行顺序。

---

## 1. 现状速览

### 1.1 三句话总结

- main 上有一份**简化版 MVP**：1 个 Prisma 模型（Task），1643 行 React 代码，3 个视图（list/kanban/calendar），基础 CRUD + 拖拽 + 子任务 + QuickAdd。
- 设计文档（`docs/task-list-design.md`）要求 **5 个 Prisma 模型 + 完整 UX + AI 集成 + 提醒系统 + 内容关联**。
- 两者**架构方向不同**：现状用 `Space` 当任务容器、`tagsJson` 字符串存标签；设计要独立的 `TaskList` 容器、`TaskTag` M2M 表。

### 1.2 高层对比矩阵

| 维度 | 现状（main） | 设计要求 | 差异等级 |
|---|---|---|---|
| Prisma 模型 | 1（Task） | 5（Task/TaskList/TaskTag/TaskContentLink/TaskReminder） | 🔴 关键 |
| 任务容器 | 复用 `Space.spaceId` | 独立 `TaskList` 模型 | 🔴 关键 |
| 标签存储 | `tagsJson` 字符串 | `TaskTag` M2M 关系表 | 🔴 关键 |
| `Task.priority` 类型 | `Int (0-4)` | `String ("NONE"/"LOW"/...)` | 🟡 中 |
| `Task.status` 枚举值 | 小写 `"todo"/"in_progress"/"done"/"archived"` | 大写 `"TODO"/"IN_PROGRESS"/"DONE"/"CANCELLED"` | 🟡 中 |
| 缺失字段 | dueTime / startDate / isAllDay / repeatRule 全无 | 全有 | 🟡 中 |
| 内容关联 | 无 | TaskContentLink 多态表 | 🟢 低（Phase 3） |
| 提醒系统 | 无 | TaskReminder + Electron Notification | 🟢 低（Phase 3） |
| 重复任务 | 无 | RRULE iCal 格式 | 🟢 低（Phase 3） |
| 入口位置 | 顶部 header `/tasks` 链接 | 左侧 sidebar 一级入口 | 🟡 中（UX 偏离） |
| 快捷键 | `Cmd+N` 全局快速添加 | `Cmd+Shift+T` | 🟡 中（不一致） |
| 智能视图 | 无 | 收集箱 / 今天 / 最近7天 / 标签 | 🟡 中（Phase 2） |
| 自然语言日期 | 无 | "明天"、"下周一"、"3月20日" | 🟢 低（Phase 2） |
| AI 工具集成 | 无 | `create_task` / `list_tasks` / AI 分解 | 🟢 低（Phase 3） |
| 完成动效 | 无 | checkbox 划线 + confetti | 🟢 低（Phase 2） |

**差异总数：13 项**（关键 3 / 中 6 / 低 4）。

### 1.3 相关文件清单

#### 现状代码（main 上）
```
prisma/schema.prisma                              Task 模型（约 601 行起）
prisma/migrations/20260713000000_task_management  建表 migration
src/app/tasks/page.tsx                            任务主页（85 行）
src/app/api/tasks/route.ts                        GET/POST /api/tasks（92 行）
src/app/api/tasks/[id]/route.ts                   PATCH/DELETE（93 行）
src/app/api/tasks/reorder/route.ts                批量重排（43 行）
src/components/tasks/types.ts                     类型 + 枚举配置（37 行）
src/components/tasks/use-tasks.ts                 数据 hook（97 行）
src/components/tasks/TaskPanel.tsx                主面板（114 行）
src/components/tasks/TaskListView.tsx             列表视图（102 行）
src/components/tasks/KanbanView.tsx               看板视图（231 行）
src/components/tasks/CalendarView.tsx             日历视图（178 行）
src/components/tasks/TaskItem.tsx                 单条任务行（272 行）
src/components/tasks/QuickAddInput.tsx            内联快加（134 行）
src/components/tasks/QuickAddDialog.tsx           弹窗快加（165 行）
src/components/ai/SubAgentTaskBlock.tsx           Agent 端任务块（少量 AI 集成）
src/app/page.tsx                                  顶栏「任务」入口（97-99 行）
```

#### 设计文档
```
docs/task-list-design.md                          总设计（572 行）
```

#### 缺失（按 snippets 约定应该有但没有）
```
docs/superpowers/specs/*-tasks-*.md               分阶段 spec（0 份，snippets 有 13 份对照）
docs/superpowers/plans/*-tasks-*.md               分阶段 plan  （0 份，snippets 有 13 份对照）
```

---

## 2. 数据模型差异（6 项 ADR）

### ADR-1：TaskList 独立模型 vs 复用 Space ★关键

**现状**（`prisma/schema.prisma` Task 模型）：
```prisma
model Task {
  // ...
  spaceId     String?   // 关联空间
  space       Space?    @relation(fields: [spaceId], references: [id])
  // ...
}
```
- 任务通过 `spaceId` 挂到 `Space` 上。
- `Space` 是 InkPress 现有的"空间"概念（用于分组文章），任务复用它当容器。
- 没有"清单"概念——所有任务要么属于某个 Space，要么 `spaceId = null`（孤立任务）。

**设计要求**（`docs/task-list-design.md` §2.1）：
```prisma
model TaskList {
  id          String   @id @default(cuid())
  name        String   // "选题池"、"本周待办"
  icon        String?
  color       String?
  sortOrder   Int      @default(0)
  isArchived  Boolean  @default(false)
  viewMode    String   @default("LIST") // LIST | BOARD | CALENDAR
  tasks       Task[]
  // ...
}
```
- 独立的清单容器，与 Space 解耦。
- 支持清单级别的视图模式、归档、颜色、图标。
- 任务通过 `taskListId` 挂到清单（可空，落到"收集箱"）。

**迁移选项**：

| 选项 | 说明 | 破坏性 | 工作量 |
|---|---|---|---|
| **A. 保留现状（Space 当容器）** | 不引入 TaskList，承认 Space 就是任务的分组容器；修订设计文档删除 TaskList 相关章节 | 无 | S |
| **B. 引入 TaskList，与 Space 并存** | Task 既可以挂 Space 也可以挂 TaskList；新增 TaskList 模型，UI 上和 Space 并列展示 | 中（schema + UI） | M |
| **C. 引入 TaskList 完全替代 Space 关联** | 数据迁移：现有 `Task.spaceId` → 新建一个默认 TaskList 或映射到对应 Space 同名 TaskList；移除 `spaceId` 字段 | 高（数据迁移） | L |

**利弊**：

- **A**：
  - ✅ 零工作量；不破坏数据
  - ✅ UX 简化：用户只需要理解 Space 一个容器概念
  - ❌ 失去清单级别特性（视图模式、归档、主题色）
  - ❌ 任务和文章混在同一个 Space 里，无法体现"选题池 / 发布计划"这种纯任务清单
  - ❌ 偏离设计文档初衷（设计明确说"任务是完全独立的一等公民"）

- **B**：
  - ✅ 兼容现状；用户可选挂哪里
  - ✅ 实现"任务作为独立一等公民"的设计意图
  - ❌ UI 复杂度上升（两个容器维度）
  - ❌ 数据模型冗余（同一概念两套实现）

- **C**：
  - ✅ 最干净；和设计文档完全对齐
  - ✅ 任务真正独立于 Space（设计核心诉求）
  - ❌ 数据迁移风险（已有任务的 `spaceId` 要映射）
  - ❌ UI 重做：左侧从"Space 列表"变成"Space 列表 + TaskList 列表"

**推荐**：🟢 **强推荐 C（完全替代），但分两步执行**
- 第一步：引入 TaskList 模型，UI 上提供 TaskList 列表，但 `Task.spaceId` 暂时保留（双写）
- 第二步：数据迁移把现有 `Task.spaceId` 映射到对应 TaskList（按 Space 名字 1:1 创建 TaskList），迁移完成后删除 `spaceId`

**理由**：
1. 设计文档 §0 明确把"任务独立优先"列为第 1 条设计原则，复用 Space 违背核心定位。
2. Space 的语义是"创作空间"（文章分组），塞任务进去会造成概念混淆（用户编辑文章时看到 Space 里混着任务）。
3. snippets 模块走了类似路径：SnippetTag 独立成表（P4-21 已实施），是 InkPress 的既定模式。
4. 双写过渡可降低风险。

---

### ADR-2：TaskTag M2M 关系表 vs tagsJson 字符串 ★关键

**现状**（`prisma/schema.prisma`）：
```prisma
model Task {
  // ...
  tagsJson    String    @default("[]")  // 标签 JSON 数组
}
```
- 标签存在 JSON 字符串里，例如 `"[\"选题\",\"紧急\"]"`。
- 没有独立 Tag 表，没有标签元数据（颜色、创建时间）。
- 标签筛选只能在应用层做（取出所有任务 → JSON.parse → filter）。

**设计要求**（§2.1）：
```prisma
model TaskTag {
  id        String   @id @default(cuid())
  name      String   @unique
  color     String?
  tasks     Task[]
  createdAt DateTime @default(now())
}
```
- 标签是一等公民，多对多关系。
- 支持标签元数据（颜色、创建时间）。
- 标签筛选可用 SQL 直接做（JOIN）。

**迁移选项**：

| 选项 | 说明 | 破坏性 | 工作量 |
|---|---|---|---|
| **A. 保留 tagsJson** | 接受 JSON 存储的局限性；修订设计文档删除 TaskTag 模型 | 无 | S |
| **B. 引入 TaskTag M2M，迁移 tagsJson 数据** | 新增 TaskTag 模型 + Task.tags 关系；写一次性脚本把现有 tagsJson 解析后批量入库；保留 tagsJson 一段时间做回退 | 中 | M |
| **C. 一步到位：引入 TaskTag + 删除 tagsJson** | B 的激进版，迁移完直接删 tagsJson 字段 | 高 | M-L |

**利弊**：

- **A**：
  - ✅ 零工作量
  - ❌ 无法做标签元数据（颜色）
  - ❌ 标签筛选/统计性能差（任务一多就要全表扫描 + JSON.parse）
  - ❌ 标签无法独立管理（重命名、合并、删除）
  - ❌ 与项目内 snippets 的既定模式不一致（snippets 已 M2M 化）

- **B / C**：
  - ✅ 标签可独立管理（重命名一处生效）、可统计、可上色
  - ✅ 与 snippets 既定模式一致
  - ❌ 数据迁移有风险（tagsJson 解析失败、标签名重复合并策略）
  - ❌ 索引/外键成本（小项目可忽略）

**推荐**：🟢 **强推荐 B（M2M + 数据迁移 + 双写过渡）**

**理由**：
1. snippets 模块已经走过完全相同的迁移（`2026-07-08-snippets-p4-tag-table-design.md` 是直接先例）。
2. JSON 字符串无法做 SQL 级筛选，Phase 2 的"按标签筛选"功能实现成本反而更高。
3. 双写过渡（tagsJson 与 TaskTag 同时维护一段时间）能彻底消除迁移风险。
4. 工作量主要在数据迁移脚本，M2M 表本身简单。

---

### ADR-3：TaskContentLink 多态关联 vs 无

**现状**：无任何任务-内容关联机制。

**设计要求**（§2.1）：
```prisma
model TaskContentLink {
  id          String   @id @default(cuid())
  taskId      String
  task        Task     @relation(...)
  contentType String   // ARTICLE | NOVEL | SCREENPLAY | NOTE | CUSTOM
  contentId   String
  contentTitle String? // 冗余存储标题快照
  note        String?
  // ...
  @@unique([taskId, contentType, contentId])
}
```
- 通用多态关联表，任务可关联任意类型的内容。
- 设计文档明确说"关联始终是可选增强，不强制"。

**迁移选项**：

| 选项 | 说明 | 工作量 |
|---|---|---|
| **A. 不实现** | Phase 3+ 的可选功能，承认现状不实现 | S |
| **B. 现在做** | 引入 TaskContentLink + task-content-registry.ts | M |

**推荐**：🟡 **倾向推荐 A（不实现，留待 Phase 3）**

**理由**：
1. 设计文档自己就把这块放到 Phase 3，明确可选。
2. 当前没有 NOVEL/SCREENPLAY 等内容类型，多态关联的价值未体现。
3. 优先级应让位于 ADR-1/ADR-2 这种核心架构决策。

---

### ADR-4：TaskReminder 提醒模型 vs 无

**现状**：无任何提醒机制。

**设计要求**（§2.1 + §6.3）：
```prisma
model TaskReminder {
  id         String   @id @default(cuid())
  taskId     String
  triggerAt  DateTime
  type       String   @default("NOTIFICATION")
  firedAt    DateTime?
  // ...
}
```
+ Electron main 进程定时轮询触发 Notification。

**迁移选项**：

| 选项 | 说明 | 工作量 |
|---|---|---|
| **A. 不实现** | Phase 3 功能，留待后续 | S |
| **B. 实现完整** | DB 模型 + Electron 轮询 + UI 设置 | M-L |

**推荐**：🟡 **倾向推荐 A（不实现，留待 Phase 3）**

**理由**：
1. 提醒依赖 Electron main 进程，Web 模式下无法工作；优先级取决于产品形态。
2. Phase 3 才需要；现在做属于过度工程。
3. 设计文档 §9 开放问题 #2 还在讨论是否同步到 inkpress-service，未拍板。

---

### ADR-5：缺失字段（dueTime / startDate / isAllDay / repeatRule）

**现状**：`Task` 只有 `dueDate DateTime?`，没有时间精度，没有开始日，没有全天标记，没有重复规则。

**设计要求**：
```prisma
model Task {
  // ...
  dueDate     DateTime?
  dueTime     String?      // "HH:mm"（可选精确到分钟）
  startDate   DateTime?    // 开始日期
  isAllDay    Boolean      @default(true)
  repeatRule  String?      // iCal RRULE 格式
  // ...
}
```

**迁移选项**：

| 选项 | 说明 | 工作量 |
|---|---|---|
| **A. 不补** | 接受当前精度，全部按"全天任务"处理 | S |
| **B. 补齐全部字段** | 加 4 个字段（都可空/有默认值），不破坏现有数据 | S-M |
| **C. 只补 isAllDay + dueTime** | 解决"全天 vs 定时"二义性；startDate/repeatRule 留待 Phase 3 | S |

**推荐**：🟢 **强推荐 C（只补 isAllDay + dueTime）**

**理由**：
1. 现状 `dueDate DateTime?` 在 UI 上无法区分"全天任务"和"下午 3 点会议"，是真实的语义缺失。
2. `isAllDay` 和 `dueTime` 都可空/有默认值，migration 零风险。
3. `startDate` 用得少，可由 `dueDate` 兼代。
4. `repeatRule` 牵涉到调度逻辑（每次完成后生成下一个实例），是独立子项目，放到 Phase 3 一起做。

---

### ADR-6：索引策略差异

**现状**（`prisma/schema.prisma`）：
```prisma
@@index([parentId])
@@index([spaceId])
@@index([status])
@@index([priority])
@@index([dueDate])
@@index([sortOrder])
```

**设计要求**：
```prisma
@@index([taskListId, status, sortOrder])
@@index([status, dueDate])
@@index([parentId])
@@index([priority, status])
```

**差异分析**：
- 现状是**单列索引**，设计是**复合索引**——后者在常见查询模式下效率更高。
- 现状有 `[spaceId]` 索引，若 ADR-1 选 C 移除 spaceId，该索引会跟着删。
- 设计的 `[taskListId, status, sortOrder]` 复合索引精准命中"打开某清单 → 按状态分组 → 按排序显示"这条主查询路径。

**推荐**：🟢 **强推荐：在 ADR-1/ADR-2 决策后同步调整索引**

**理由**：
1. 复合索引对小数据集性能差距不明显，但 Phase 2 引入智能视图（按 dueDate 范围 + status 过滤）后会显著受益。
2. 工作量极小（migration 里 `DROP INDEX` + `CREATE INDEX`）。
3. 不破坏数据。

---

## 3. 枚举与类型差异（2 项 ADR）

### ADR-7：status 大小写

**现状**（`src/components/tasks/types.ts`）：
```typescript
export type TaskStatus = "todo" | "in_progress" | "done" | "archived";
```
DB 里存的也是这些小写字符串。

**设计要求**（§2.1）：
```
status String @default("TODO") // TODO | IN_PROGRESS | DONE | CANCELLED
```

**差异**：
1. 大小写：小写 vs 大写
2. 终态值：`"archived"` vs `"CANCELLED"`——语义不同！设计把"已取消"作为终态，现状用"已归档"

**迁移选项**：

| 选项 | 说明 | 工作量 |
|---|---|---|
| **A. 保持现状** | 修订设计文档对齐代码 | S |
| **B. 改为大写 + 增加 CANCELLED** | 数据迁移：`todo→TODO`、`archived→?`（语义二义性） | M |
| **C. 保持小写但增加 `cancelled`** | 只补 cancelled 一个枚举值，不动大小写 | S |

**利弊**：

- **A**：
  - ✅ 零工作量
  - ❌ "archived" 和 "cancelled" 语义不同（archived 是事后整理，cancelled 是放弃），合二为一会丢信息
- **B**：
  - ✅ 与设计文档完全一致
  - ❌ 现有数据 `"archived"` 无法确定该映射到 `CANCELLED` 还是该删
  - ❌ 全代码搜字符串字面量，容易漏改
- **C**：
  - ✅ 解决语义缺失（补 cancelled）
  - ✅ 不破坏现有数据
  - ❌ 与设计文档大小写不一致（但可以反过来修订设计文档）

**推荐**：🟢 **强推荐 C（保持小写 + 补 cancelled）**

**理由**：
1. 大小写是纯偏好问题，没有技术差异——SQLite 字符串比较大小写敏感，但应用层已经统一了。
2. "archived vs cancelled"是真实语义差异，应该都保留：archived 是完成后的归档（事后整理），cancelled 是放弃（始终未完成）。
3. 改大小写收益低、风险高（容易漏改字面量）。
4. 应该回头修订设计文档 §2.1 的枚举定义。

---

### ADR-8：priority 类型（Int vs String）

**现状**（`prisma/schema.prisma` + `types.ts`）：
```prisma
priority Int @default(0) // 0=none, 1=low, 2=medium, 3=high, 4=urgent
```
```typescript
export type TaskPriority = 0 | 1 | 2 | 3 | 4;
export const PRIORITY_CONFIG: Record<TaskPriority, {...}> = {
  0: { label: "无", emoji: "" },
  1: { label: "低", emoji: "🔵" },
  // ...
};
```

**设计要求**（§2.1）：
```
priority String @default("NONE") // NONE | LOW | MEDIUM | HIGH | URGENT
```

**迁移选项**：

| 选项 | 说明 | 工作量 |
|---|---|---|
| **A. 保持 Int** | 修订设计文档对齐代码 | S |
| **B. 改为 String** | 数据迁移：0→"NONE"、1→"LOW"…；全代码替换 | M |

**利弊**：

- **Int**：
  - ✅ DB 排序天然正确（`ORDER BY priority DESC` 即可）
  - ✅ 索引效率高
  - ✅ TS 类型 `0|1|2|3|4` 有编译期约束
  - ❌ 不够自描述（看 DB 数据要查映射）
- **String**：
  - ✅ 自描述（`"URGENT"` 一眼明白）
  - ❌ 排序要在应用层维护枚举顺序
  - ❌ 索引体积略大（可忽略）

**推荐**：🟢 **强推荐 A（保持 Int，修订设计文档）**

**理由**：
1. Int 的排序优势在任务列表里非常实用（拖拽排序时经常需要按优先级分组）。
2. 自描述问题已经在 `PRIORITY_CONFIG` 里解决（label/emoji 配置表）。
3. 改 String 的纯风险，无收益。
4. 设计文档这里的 String 写法可能是早期构想，没有充分考虑排序需求。

---

## 4. 功能差异（按设计 §7 四阶段映射）

### Phase 1：核心 CRUD（MVP）

| 设计要求 | 现状 | 状态 |
|---|---|---|
| 数据模型 migration | ✅ 已建 Task 表（migration `20260713000000`） | ⚠️ 模型不完整（见 ADR-1/2/5） |
| 任务清单 CRUD | ❌ 用 Space 代替，无独立 TaskList | 🔴 见 ADR-1 |
| 任务 CRUD（创建/编辑/完成/删除） | ✅ `/api/tasks` + `/api/tasks/[id]` | ✅ |
| 列表视图（含子任务缩进） | ✅ `TaskListView.tsx` + `TaskItem.tsx` 支持 parentId | ✅ |
| 侧边栏入口 + 路由 | ⚠️ 顶部 header 有 `/tasks` 链接，无左侧 sidebar | 🟡 见 §5.1 |
| 快速创建输入框（内联） | ✅ `QuickAddInput.tsx` | ✅ |
| 优先级 + 截止日设置 | ✅ TaskItem 内置选择器 | ✅ |
| 拖拽排序 | ✅ `/api/tasks/reorder` + 前端 dnd | ✅ |

**Phase 1 偏离点**：
- 顶部 header 入口 vs 设计要求的左侧 sidebar 一级入口（见 §5.1）
- 快捷键 `Cmd+N` vs 设计要求 `Cmd+Shift+T`
- 任务容器是 Space 而非 TaskList（见 ADR-1）

### Phase 2：智能视图 + 交互增强

| 设计要求 | 现状 | 状态 |
|---|---|---|
| "今天" / "最近 7 天" 智能视图 | ❌ | 🔴 完全缺失 |
| "收集箱"（taskListId IS NULL） | ⚠️ 现状 spaceId=null 等价，但 UI 不暴露 | 🟡 |
| 标签系统 | ⚠️ 有 tagsJson 但无 UI 筛选/管理 | 🟡 见 ADR-2 |
| 全局快速添加浮窗（`Cmd+Shift+T`） | ⚠️ 有 QuickAddDialog 但绑 `Cmd+N` | 🟡 |
| 自然语言日期解析 | ❌ | 🔴 完全缺失 |
| 看板视图 | ✅ `KanbanView.tsx`（231 行） | ✅ |
| 完成动效 | ❌ | 🟢 缺失（小特性） |
| 键盘快捷键全覆盖 | ⚠️ 仅 Cmd+N，缺 Space/Tab/箭头导航/Cmd+D 等 | 🟡 |

### Phase 3：内容关联 + 深度集成

| 设计要求 | 现状 | 状态 |
|---|---|---|
| 通用内容关联机制（TaskContentLink） | ❌ | 🔴 见 ADR-3 |
| 内容类型注册表 | ❌ | 🔴 |
| 日历视图 | ✅ `CalendarView.tsx`（178 行） | ✅ |
| 提醒系统（Electron Notification） | ❌ | 🔴 见 ADR-4 |
| AI 任务创建/分解工具 | ❌ | 🔴 见 §5.3 |
| 编辑器右键"创建待办" | ❌ | 🔴 |
| 重复任务规则 | ❌ | 🔴 见 ADR-5 |

### Phase 4：高级特性（可选）

| 设计要求 | 现状 |
|---|---|
| 任务模板 | ❌ |
| 统计面板（完成率、燃尽图） | ❌ |
| 番茄钟集成 | ❌ |
| 导入/导出（TickTick CSV） | ❌ |

---

## 5. 集成点差异（5 项）

### 5.1 入口位置：顶部 header vs 左侧 sidebar

**现状**（`src/app/page.tsx:97-99`）：
```tsx
<Link href="/tasks">
  <CheckSquareIcon className="h-4 w-4" />
  任务
</Link>
```
- 入口在首页顶部 header 的导航条里。
- InkPress 整体使用顶部 header 导航，**没有左侧 sidebar 这一 UI 元素**。

**设计要求**（§1.1）：
> 在现有左侧导航栏中，于「我的文章」和「素材库」之间新增一级入口

**差异分析**：
设计文档假设 InkPress 有左侧 sidebar，但实际是顶部 header。**这是设计文档对项目结构的过时假设**——不是代码偏离，是文档需要修订。

**推荐**：🟢 **强推荐：修订设计文档 §1.1**——把"左侧 sidebar 一级入口"改成"顶部 header 导航入口"，现状已实现。

### 5.2 编辑器右键菜单"创建待办"

**现状**：无。
**设计要求**：选中文本 → 右键 → "创建待办"。
**推荐**：🟡 倾向推荐**延后**——这是 Phase 3 增强项，且依赖 TaskContentLink（见 ADR-3）。

### 5.3 AI Agent 工具集成

**现状**：仅有 `src/components/ai/SubAgentTaskBlock.tsx`（少量 AI 端展示）。
**设计要求**：
- `create_task` 工具：Agent 调用创建任务
- `list_tasks` 工具：Agent 列出任务
- AI 分解子任务：复杂任务自动建议 3-7 个子任务

**推荐**：🟡 **倾向推荐 Phase 3 一起做**——AI 工具要先有清晰的 service 层（task-service.ts，设计文档 §6.1 提到但现状没有），是较大子项目。

### 5.4 全局搜索 / Cmd+K 命令面板

**现状**：`GlobalSearch.tsx` 存在，但未集成 tasks。
**设计要求**：扩展 `Cmd+K` 命令面板，搜索任务、跳转。
**推荐**：🟢 **强推荐：Phase 2 一起做**——工作量小（GlobalSearch 已经是统一的搜索入口，加一个 source 即可）。

### 5.5 内容详情侧栏 TaskContentSection

**现状**：无。
**设计要求**：任意内容详情页侧边栏可展示"关联任务"区块。
**推荐**：🟡 **依赖 ADR-3**——若 ADR-3 决定不实现，本项也跳过。

---

## 6. 推荐迁移路径（分阶段、可回退）

> 本节是各 ADR 推荐的串行执行顺序，按**破坏性递增 + 价值递减**排列。每阶段独立可发版、可回退。

### 阶段 A：低破坏补齐（优先级最高）🟢

**目标**：补齐不破坏现有数据的小改进，让现有 MVP 更接近设计意图。

| 子项 | 关联 ADR | 工作量 | 破坏性 |
|---|---|---|---|
| 补 `Task.isAllDay` + `Task.dueTime` 字段 | ADR-5 | S | 无（都可空） |
| 快捷键 `Cmd+N` → `Cmd+Shift+T` | §4 Phase 1 | S | 无 |
| 修订设计文档 §1.1：sidebar → header | §5.1 | S | 无（改文档） |
| 加 cancelled 枚举（保持小写） | ADR-7 | S | 无 |
| GlobalSearch 集成 tasks | §5.4 | S | 无 |
| 调整索引为复合索引 | ADR-6 | S | 无 |
| Phase 2 智能视图（今天 / 最近7天 / 收集箱） | §4 Phase 2 | M | 无（只读查询） |

**总工作量**：约 M（2-3 天集中投入）。
**回退方案**：每个子项独立 commit，可逐项 revert。
**前置条件**：无。

### 阶段 B：TaskTag M2M 化 🟡

**目标**：标签从字符串升级为一等公民，解锁 Phase 2 的标签筛选/管理。

**步骤**：
1. 新增 `TaskTag` 模型 + `Task.tags` M2M 关系
2. 新增 `Task.tagsJson` 字段保留（双写期）
3. 写一次性数据迁移脚本：解析所有 `tagsJson` → upsert TaskTag → 建立 M2M 关联
4. 改应用层所有读写 tags 的代码，从 tagsJson 切到 M2M（保留 tagsJson 写入作为容灾）
5. 灰度一周，验证 M2M 数据正确
6. 删除 `tagsJson` 字段 + 相关代码

**工作量**：M（参考 snippets `2026-07-08-snippets-p4-tag-table.md` 的 561 行 plan）。
**回退方案**：步骤 6 之前都可回退（双写期内 tagsJson 仍是真相之源）。
**前置条件**：阶段 A 完成。

### 阶段 C：TaskList 独立化（破坏性最大）🔴

**目标**：把任务从 Space 解耦，真正实现"任务独立一等公民"。

**步骤**：
1. 新增 `TaskList` 模型（不删 `Task.spaceId`）
2. 数据迁移：为每个有任务挂载的 Space 创建同名 TaskList，`Task.taskListId` = 对应 TaskList.id
3. UI 重做：左侧新增"我的清单"区块（类似 snippets 的 SnippetTagSidebar）
4. 应用层切换：所有按 spaceId 查询的地方改按 taskListId 查询
5. 灰度两周，验证数据
6. 删除 `Task.spaceId` 字段 + Space-Task 关系

**工作量**：L（参考 snippets P2 tag-system 的 548 行 plan + sidebar 重做）。
**回退方案**：步骤 6 之前都可回退；步骤 1-3 是纯增量，不影响现有功能。
**前置条件**：阶段 B 完成（避免两个迁移纠缠）。
**风险**：
- 用户自定义的 Space → TaskList 映射可能不满 1:1（同名冲突、空 Space 怎么办）
- 与 snippets 的 Space 关系解耦方向一致，但 snippets 自己目前还用 spaceId，存在方向分歧

### 阶段 D：新功能（Phase 3）🟢

**目标**：补齐 Phase 3 的所有缺失功能。

| 子项 | 优先级 | 工作量 |
|---|---|---|
| TaskContentLink 多态关联 | 中 | M |
| 内容类型注册表 | 中 | S |
| 编辑器右键"创建待办" | 低 | S |
| 提醒系统（Electron Notification） | 低 | M |
| AI 工具（create_task / list_tasks） | 中 | M |
| AI 分解子任务 | 低 | M |
| 重复任务（RRULE） | 低 | L |

**总工作量**：约 2L。
**前置条件**：阶段 A/B/C 至少完成 A 和 B。

---

## 7. 未决策问题清单（留给下一轮）

以下问题本文档不拍板，留给下一轮 plan 阶段决策：

1. **是否启动阶段 C（TaskList 独立化）**：工作量 L，破坏性高。如果不做，整个任务模块就停在"挂在 Space 下的简化版"，但能省下大量工作。
2. **snippets 模块是否同步迁移**：snippets 当前也用 spaceId，若 tasks 走 TaskList 独立化，是否应该同步重构 snippets？（参考 `2026-07-08-snippets-p2-tag-system.md` 里的决策）
3. **TaskContentLink 的 contentType 枚举范围**：当前只有 ARTICLE，是否预留 NOVEL/SCREENPLAY 等占位？
4. **重复任务调度策略**：RRULE 解析后是预生成实例还是按需计算？两种方案对 DB 压力不同。
5. **AI 工具的权限边界**：Agent 创建任务是否需要用户确认？是否限制每会话创建数量？
6. **任务数据同步到 inkpress-service**：设计 §9 开放问题 #2 未拍板。本地优先 vs 云端同步，影响整个数据层设计。
7. **任务模板的形态**：用户自定义 JSON？预设模板库？

---

## 附录 A：完整差异矩阵（13 项一表览）

| # | 维度 | 现状 | 设计 | 推荐 | 工作量 |
|---|---|---|---|---|---|
| 1 | Prisma 模型数 | 1 | 5 | C 路径分步补齐 | L（累计） |
| 2 | TaskList 容器 | 复用 Space | 独立模型 | 🟢 C（强推荐） | L |
| 3 | 标签存储 | tagsJson | TaskTag M2M | 🟢 B（强推荐） | M |
| 4 | TaskContentLink | 无 | 多态关联 | 🟡 A（延后） | M |
| 5 | TaskReminder | 无 | 有 | 🟡 A（延后） | M-L |
| 6 | 缺失字段 | 仅 dueDate | +3 字段 | 🟢 C（补 isAllDay+dueTime） | S |
| 7 | 索引策略 | 单列 | 复合 | 🟢 ADR-1/2 后同步 | S |
| 8 | status 大小写 | 小写 | 大写 | 🟢 C（保持小写） | S |
| 9 | status 终态值 | archived | CANCELLED | 🟢 C（补 cancelled） | S |
| 10 | priority 类型 | Int | String | 🟢 A（保持 Int） | S |
| 11 | 入口位置 | 顶部 header | 左侧 sidebar | 🟢 修订设计文档 | S |
| 12 | 快捷键 | Cmd+N | Cmd+Shift+T | 🟢 改快捷键 | S |
| 13 | AI 工具集成 | 无 | create_task/list_tasks | 🟡 Phase 3 | M |

---

## 附录 B：相关文件清单（main 上 14 个 task 文件 + 2 个入口）

```
prisma/
├── schema.prisma                                          [Task 模型 601 行起]
└── migrations/
    └── 20260713000000_task_management/migration.sql       [建表]

src/app/
├── page.tsx                                               [顶栏入口 97-99 行]
├── tasks/page.tsx                                         [任务主页 85 行]
└── api/tasks/
    ├── route.ts                                           [GET/POST 92 行]
    ├── [id]/route.ts                                      [PATCH/DELETE 93 行]
    └── reorder/route.ts                                   [批量重排 43 行]

src/components/tasks/
├── types.ts                                               [类型+枚举 37 行]
├── use-tasks.ts                                           [数据 hook 97 行]
├── TaskPanel.tsx                                          [主面板 114 行]
├── TaskListView.tsx                                       [列表视图 102 行]
├── KanbanView.tsx                                         [看板视图 231 行]
├── CalendarView.tsx                                       [日历视图 178 行]
├── TaskItem.tsx                                           [单条任务 272 行]
├── QuickAddInput.tsx                                      [内联快加 134 行]
└── QuickAddDialog.tsx                                     [弹窗快加 165 行]

src/components/ai/
└── SubAgentTaskBlock.tsx                                  [Agent 端展示]
```

**总计**：约 1643 行代码。

---

## 附录 C：术语表

| 术语 | 含义 |
|---|---|
| **ADR** | Architecture Decision Record，架构决策记录。本文档每项差异的固定结构 |
| **Space** | InkPress 现有的"空间"概念，用于分组文章（`prisma Space` 模型） |
| **TaskList** | 设计文档定义的"清单"概念，独立任务容器（现状未实现） |
| **TaskTag** | 设计文档定义的标签 M2M 模型（现状用 tagsJson 字符串代替） |
| **TaskContentLink** | 任务到任意内容的可选多态关联（现状未实现） |
| **TaskReminder** | 任务提醒记录（现状未实现） |
| **MVP** | Minimum Viable Product，最小可用版 |
| **RRULE** | iCal 重复规则格式（如 `FREQ=WEEKLY;BYDAY=FR`） |
| **Phase 1-4** | 设计文档 §7 的 4 阶段实施计划 |
| **双写期** | 数据迁移时新旧字段同时写入的过渡期，用于容灾和回退 |
| **T-shirt size** | 工作量估算：S(<1天)、M(1-3天)、L(>3天) |

---

## 文档元信息

- **生成方式**：基于 main 分支 `3f7173b9`（feat(tasks)）与 `docs/task-list-design.md` 对照分析
- **下一步**：本文档不做决策。用户审阅后，下一轮可：
  - 选择启动阶段 A（低破坏补齐）→ 进入 writing-plans skill 写阶段 A 的实施计划
  - 或选择启动阶段 B/C 中的任意一项 → 同上
  - 或修订本文档的推荐意见后重新决策
- **关联文档**：`docs/task-list-design.md`（总设计）、`docs/superpowers/specs/`（待新增的分阶段 spec）
