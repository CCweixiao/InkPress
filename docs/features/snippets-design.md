# 素材块（Snippets）功能设计

> **定位**：灵感碎片收集器 —— 用于快速捕捉零碎想法、图文片段、引用句子、灵光一现的 idea。区别于文章（长篇结构化内容）和素材库（文件资源管理），素材块强调**轻量录入、快速浏览、碎片化组织**。

---

## 1. 产品定位与边界

| 维度 | 素材块 (Snippets) | 文章 (Article) | 素材库 (Materials) |
|------|-------------------|----------------|---------------------|
| 内容形态 | 短文字 / 图文混排片段 / 引用 / 链接 | 长篇结构化 Markdown | 图片/视频/文件等二进制资源 |
| 典型长度 | 1~500 字 | 1000+ 字 | N/A（文件维度） |
| 创建成本 | 极低（< 3 秒） | 高（需编辑器环境） | 中（上传流程） |
| 组织方式 | 标签 + 时间流 | 空间 → 文章层级 | 空间 → 文章绑定 |
| 最终归宿 | 可引用插入文章 / 独立存在 | 发布到渠道 | 被文章引用 |

---

## 2. 导航入口设计

### 2.1 顶栏入口（与现有布局契合）

在首页顶栏 nav 区域，紧随「素材」按钮之后，新增「灵感」入口：

```
[技术文档] [素材] [灵感] [技能仓库] [回收站] [设置]
```

- **图标**：`Sparkles`（lucide-react），传达灵感/碎片感
- **文案**：「灵感」（两字，与其他入口长度一致）
- **路由**：`/snippets`

### 2.2 首页快捷入口（可选）

在首页文章列表上方，增加一个轻量的「快速记录」浮动入口：

```
┌─────────────────────────────────────────────┐
│  ✦ 记录一个灵感...           [标签▾] [回车] │
└─────────────────────────────────────────────┘
```

- 类似 macOS Spotlight / Notion Quick Note 的 inline 输入框
- 输入文字后回车即创建一条素材块，零摩擦
- 可选添加标签，不选则归入「未分类」

### 2.3 全局快捷键

- `Ctrl/Cmd + Shift + N`：全局呼出「快速记录」弹窗（overlay modal）
- 在编辑器内：选中文字后右键菜单「保存为灵感片段」

---

## 3. 页面布局设计

### 3.1 主页面 `/snippets`

采用 **瀑布流 / 时间线** 混合布局（非传统表格），呼应「碎片化」气质：

```
┌──────────────────────────────────────────────────────────────────┐
│  ← 返回 / 灵感                                                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [全部] [文字] [图文] [引用] [链接]     🔍 搜索     [+ 新建]     │
│                                                                  │
│  ┌─ 标签侧栏 ─┐  ┌─ 内容区（瀑布流）────────────────────────┐  │
│  │             │  │                                          │  │
│  │ # 全部 (42) │  │  ┌──────────┐  ┌──────────────────────┐ │  │
│  │ # 产品想法  │  │  │ 短文字卡 │  │ 图文混排卡片         │ │  │
│  │ # 技术灵感  │  │  │ 片段…    │  │ [图片]               │ │  │
│  │ # 阅读摘录  │  │  │          │  │ 配文描述…            │ │  │
│  │ # 设计参考  │  │  └──────────┘  └──────────────────────┘ │  │
│  │             │  │                                          │  │
│  │ + 新建标签  │  │  ┌──────────────────────┐  ┌──────────┐ │  │
│  │             │  │  │ 引用块               │  │ 链接卡片 │ │  │
│  │             │  │  │ "某人说的某句话…"    │  │ 🔗 URL   │ │  │
│  │             │  │  │ —— 出处              │  │ 摘要…    │ │  │
│  │             │  │  └──────────────────────┘  └──────────┘ │  │
│  │             │  │                                          │  │
│  └─────────────┘  └──────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 布局要点

| 方面 | 设计决策 |
|------|---------|
| 整体风格 | 与首页一致：`max-w-6xl` 居中，`px-6 py-8` 间距 |
| 顶部 Header | 复用项目统一 Header 样式（ArrowLeft 返回 + 图标 + 标题） |
| 左侧栏 | 标签导航，宽度 `w-48`，可折叠（移动端默认收起） |
| 内容区 | CSS Grid 瀑布流：`grid-cols-2 lg:grid-cols-3`，卡片高度自适应 |
| 卡片样式 | 圆角 Card + hover 阴影，内容不截断（短文本不需要 line-clamp） |
| 排序 | 默认按创建时间倒序（最新在前），可切换「按更新时间」 |
| 空状态 | 居中引导："记录你的第一个灵感片段 ✨"，配新建按钮 |

### 3.3 卡片类型设计

#### 文字片段卡
```
┌─────────────────────────┐
│ 这是一段灵感文字，可能   │
│ 是几句话的随想…         │
│                         │
│ #产品想法  ·  2 分钟前   │
└─────────────────────────┘
```

#### 图文混排卡
```
┌─────────────────────────┐
│ ┌─────────────────────┐ │
│ │      [图片]         │ │
│ └─────────────────────┘ │
│ 配图的一段描述文字…     │
│                         │
│ #设计参考  ·  昨天       │
└─────────────────────────┘
```

#### 引用块卡
```
┌─────────────────────────┐
│ ┃ "好的产品设计是减法"   │
│ ┃                       │
│        —— 张小龙        │
│                         │
│ #阅读摘录  ·  3 天前     │
└─────────────────────────┘
```

#### 链接卡
```
┌─────────────────────────┐
│ 🔗 文章标题              │
│ https://example.com/... │
│ 摘要/备注文字…          │
│                         │
│ #技术灵感  ·  1 周前     │
└─────────────────────────┘
```

---

## 4. 前端交互设计

### 4.1 创建交互（核心体验）

**设计原则**：3 秒内完成一次灵感记录，零心智负担。

#### 方式一：内联创建（页面顶部）
- 页面内容区顶部固定一个 `textarea`，类似 Twitter 发推框
- placeholder: "记录一个灵感…（支持粘贴图片）"
- 支持 `Ctrl+V` 粘贴图片，自动上传变成图文混排
- 按 `Ctrl+Enter` 或点击按钮提交
- 提交后卡片以动画（fade-in + slide-down）出现在流中

#### 方式二：全局快捷弹窗
- `Ctrl/Cmd+Shift+N` 呼出 Dialog
- 与页面内创建相同的编辑器，但以 overlay 形式
- 创建成功后自动关闭，toast 提示"灵感已保存"

#### 方式三：从编辑器摘录
- 在文章编辑器中选中文字 → 右键菜单 / toolbar 按钮 → 「保存为灵感」
- 自动带上来源文章信息（articleId + title）

### 4.2 编辑交互

- 点击卡片 → 原地展开为编辑态（inline editing），不跳转新页面
- 编辑态：textarea + 图片操作区 + 标签选择
- 失焦或 `Ctrl+Enter` 自动保存
- 长按 / 右键 → 操作菜单：编辑 / 删除 / 引用到文章 / 复制内容

### 4.3 标签交互

- 创建时可选标签（typeahead 补全），也可不选
- 标签支持颜色标记（预设 8 种颜色）
- 左侧栏标签列表支持拖拽排序
- 点击标签 = 筛选，再次点击 = 取消筛选
- 支持多标签组合筛选（AND 逻辑）

### 4.4 引用到文章

- 在素材块卡片上点击「引用」→ 选择目标文章 → 以 blockquote / 内嵌卡片形式插入
- 编辑器侧边栏可浏览素材块列表，拖拽到编辑区插入
- 插入后保持引用关系（snippet 更新 → 文章侧可见变更提示）

### 4.5 搜索与筛选

- 顶部搜索框：全文检索（标题 + 正文 + 标签）
- 筛选维度：类型（文字/图文/引用/链接）+ 标签 + 时间范围
- 搜索结果高亮匹配文字

---

## 5. AI 对话框 @灵感引用 交互设计

> **核心场景**：用户在写作助手对话框中输入 `@` 触发灵感素材检索面板，选中素材后以 chip 形式嵌入输入框，发送时 AI 自动加载素材内容、风格对齐后融入生成文章。

### 5.1 触发与检索面板

#### 触发时机
- 用户在 `ChatTextarea` 中任意位置输入 `@` 字符
- 立即弹出「灵感检索面板」（floating panel），类似 GitHub Issue 的 @mention 或 Notion 的 /command
- 与现有 `/` 斜杠命令系统平行（`/` = 命令，`@` = 灵感引用）

#### 检索面板布局（极致体验）

```
              ┌─────────────────────────────────────────────┐
              │  🔍 搜索灵感…               [标签] [类型▾]  │
              ├─────────────────────────────────────────────┤
              │                                             │
              │  ┌───────────────────────────────────────┐  │
              │  │ ✦ "好的产品设计是减法"                 │  │
              │  │   #阅读摘录 · 引用 · 3天前             │  │
              │  └───────────────────────────────────────┘  │
              │  ┌───────────────────────────────────────┐  │
              │  │ ✦ 用户增长的本质是价值传递…            │  │
              │  │   #产品想法 · 文字 · 昨天              │  │
              │  └───────────────────────────────────────┘  │
              │  ┌───────────────────────────────────────┐  │
              │  │ ✦ [缩略图] 竞品交互截图               │  │
              │  │   #设计参考 · 图文 · 1周前             │  │
              │  └───────────────────────────────────────┘  │
              │                                             │
              │  ↑↓ 导航 · Enter 选中 · Esc 关闭          │
              └─────────────────────────────────────────────┘
```

#### 面板交互细节

| 交互 | 行为 |
|------|------|
| `@` 后继续输入 | 实时过滤（模糊搜索 content + tags） |
| `↑` / `↓` | 在候选列表中移动高亮 |
| `Enter` | 选中当前高亮项，插入 chip 到输入框 |
| `Esc` | 关闭面板，保留 `@` 字符 |
| 鼠标点击 | 直接选中对应灵感条目 |
| 面板内标签 pill | 点击可快速按标签筛选 |
| 面板内类型下拉 | 筛选文字/图文/引用/链接 |

#### 面板视觉设计原则

1. **轻盈浮动**：`shadow-lg rounded-xl border` + backdrop-blur，不遮挡对话内容
2. **信息密度适中**：每条 1 行主内容 + 1 行元信息（标签 · 类型 · 时间）
3. **图文预览**：图文类型在左侧显示 32×32 缩略图
4. **键盘优先**：全程键盘可完成（输入 → 筛选 → 选中），鼠标为辅助
5. **即搜即得**：无需额外确认步骤，选中即插入

### 5.2 Chip 嵌入对话框

选中灵感后，在输入框中 `@` 位置替换为一个**不可编辑的 inline chip**：

```
┌──────────────────────────────────────────────────────────────────┐
│ 帮我写一篇关于产品设计的文章，融入 [@好的产品设计是减法] 的观点，│
│ 同时参考 [@用户增长的本质是价值传递] 这个角度来展开论述           │
│                                                                  │
│  ✦模型▾  📊Token           [■ 停止] / [➤ 发送]                  │
└──────────────────────────────────────────────────────────────────┘
```

#### Chip 设计

- 样式：`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs`
- 内容：`✦` 图标 + 素材标题/首行文字（截断至 20 字）
- 可删除：chip 尾部有 `×` 按钮，或光标退格到 chip 位置时删除
- 悬停预览：hover 时 tooltip 显示完整内容摘要
- 多个 chip：支持一条消息中多次 `@`，每个独立 chip

#### 数据结构（输入框内部状态）

```ts
type ComposerState = {
  // 纯文本部分 + chip 占位
  segments: Array<
    | { type: "text"; value: string }
    | { type: "snippet-ref"; snippetId: string; displayText: string }
  >;
};
```

### 5.3 发送与 AI 处理流程

#### 发送时序列化

用户点击发送时，将 `segments` 序列化为结构化消息：

```ts
// 发送给后端的消息体
{
  message: "帮我写一篇关于产品设计的文章，融入 {{snippet:clxxx1}} 的观点，同时参考 {{snippet:clxxx2}} 这个角度来展开论述",
  snippetRefs: ["clxxx1", "clxxx2"]  // 按出现顺序
}
```

#### AI Agent 处理流程

```
用户消息（含 snippet refs）
    ↓
① Agent 解析 {{snippet:id}} 占位符
    ↓
② 批量调用 load_snippets(ids) 工具加载素材内容
    ↓
③ Agent 获得完整素材（content + imageUrl + quoteSource 等）
    ↓
④ 分析当前文章风格（已有 currentMarkdown 上下文）
    ↓
⑤ 对每个灵感素材：
   - 保持核心语义不变
   - 表述风格对齐当前文章（正式/轻松/技术...）
   - 确定最佳插入位置（按用户指令 + 内容逻辑）
    ↓
⑥ 生成文章，灵感素材自然融入
```

#### 新增 Agent 工具

```ts
// lib/ai/tools — 新增
const load_snippets = {
  name: "load_snippets",
  description: "加载灵感素材块的完整内容。当用户消息中包含 {{snippet:id}} 引用时调用。",
  parameters: {
    ids: { type: "array", items: { type: "string" }, description: "素材块 ID 数组" }
  },
  execute: async ({ ids }) => {
    const snippets = await prisma.snippet.findMany({
      where: { id: { in: ids }, trashed: false },
      select: { id: true, content: true, kind: true, imageUrl: true, quoteSource: true, linkUrl: true, linkTitle: true, tagsJson: true }
    });
    return snippets;
  }
};
```

#### System Prompt 注入（灵感融入指令）

当消息包含 snippet refs 时，在 system prompt 中追加：

```
用户消息中 {{snippet:xxx}} 标记引用了灵感素材。你已通过 load_snippets 加载了它们的完整内容。
融入规则：
1. 保持素材的核心观点和事实不变，不歪曲原意
2. 将表述风格对齐当前文章的语气和用词习惯
3. 在文章中自然融入，不生硬拼接，找到逻辑上最合适的位置
4. 按 {{snippet:xxx}} 在用户消息中的顺序，对应融入到文章的前后结构中
5. 图文素材：保留图片引用，调整配文风格
6. 引用素材：以 blockquote 形式保留，可调整引入语
```

### 5.4 编辑器内拖拽插入

除了通过 AI 对话框 `@` 引用灵感，还支持**直接拖拽**灵感素材到文章编辑区：

#### 入口
- 编辑器右侧 / 底部浮动「灵感面板」（SnippetInsertPanel）
- 可展开为侧边栏，显示灵感卡片列表（复用 SnippetCard 缩略模式）

#### 拖拽交互

```
 ┌─ 灵感面板 ─┐        ┌─ 文章编辑区 ──────────────────────┐
 │             │        │                                    │
 │ [≡] 灵感A  │ ─drag→ │  第一段文字…                       │
 │ [≡] 灵感B  │        │  ─ ─ ─ ─ ─ ─ ─ (drop indicator) ─ │
 │ [≡] 灵感C  │        │  第二段文字…                       │
 │             │        │                                    │
 └─────────────┘        └────────────────────────────────────┘
```

| 行为 | 效果 |
|------|------|
| 拖拽到编辑区 | 显示蓝色 drop indicator 线（插入位置预览） |
| 松手释放 | 素材内容以 blockquote / 文字段落形式插入到对应位置 |
| 图文素材 | 插入图片 + 描述文字 |
| 引用素材 | 插入 `> "引文内容" —— 出处` 格式 |
| 链接素材 | 插入 `[标题](url) — 备注` 格式 |

#### 插入格式

素材插入编辑区时的 Markdown 映射：

```markdown
<!-- kind: text -->
素材正文内容直接插入

<!-- kind: quote -->
> "好的产品设计是减法"
>
> —— 张小龙

<!-- kind: image -->
![描述文字](https://xxx/image.png)
配图的一段描述文字…

<!-- kind: link -->
[文章标题](https://example.com) — 摘要备注文字
```

---

## 6. 数据模型设计（增强版）

### 6.1 Prisma Schema

```prisma
/// 素材块 — 灵感碎片（文字/图文/引用/链接）
/// 设计原则：字段平铺（非 JSON 嵌套），便于数据库索引和 AI 工具结构化读取
model Snippet {
  id          String    @id @default(cuid())
  
  // ─── 核心内容 ───
  title       String    @default("")  // 素材标题（可空，自动从 content 首行提取）
  content     String    // 正文（纯文本或轻量 Markdown，≤500字）
  kind        String    @default("text") // "text" | "image" | "quote" | "link"
  
  // ─── 图文混排 ───
  imageUrl    String?   // 主图 URL（内联图或粘贴图，直接可用于渲染和 AI 引用）
  imageAssetId String?  // 关联的 Asset ID（通过素材库上传时建立引用）
  imagesJson  String    @default("[]") // 多图场景：[{url, caption}] JSON数组
  
  // ─── 引用块 ───
  quoteSource String?   // 引用出处/作者
  
  // ─── 链接块 ───
  linkUrl     String?   // 原始 URL
  linkTitle   String?   // 链接标题（OG title 自动抓取 / 手动填写）
  linkDescription String? // 链接描述（OG description）
  linkImage   String?   // 链接预览图（OG image）
  
  // ─── 组织与检索 ───
  tagsJson    String    @default("[]") // 标签数组 JSON ["产品想法","技术灵感"]
  color       String?   // 卡片强调色（预设色板，如 "amber" | "blue" | "green"）
  
  // ─── 来源追踪 ───
  sourceArticleId String? // 从哪篇文章摘录的（保持引用溯源）
  sourceUrl    String?    // 外部来源 URL（从网页摘录时记录）
  
  // ─── AI 辅助字段 ───
  embedding   String?   // 语义向量（JSON float[]），用于 AI 检索相关素材
  aiSummary   String?   // AI 生成的一句话摘要（用于 @面板快速预览）
  usageCount  Int       @default(0) // 被引用/使用次数（排序权重）
  
  // ─── 状态 ───
  pinned      Boolean   @default(false)
  trashed     Boolean   @default(false)
  trashedAt   DateTime?
  
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  sourceArticle Article? @relation(fields: [sourceArticleId], references: [id], onDelete: SetNull)

  @@index([kind])
  @@index([pinned, createdAt])
  @@index([trashed])
  @@index([createdAt])
  @@index([usageCount])       // 按热度排序
  @@index([sourceArticleId])  // 追溯来源文章的素材
}
```

### 6.2 Schema 设计理念

| 设计决策 | 理由 |
|---------|------|
| `title` 独立字段 | @面板检索需要快速展示标题，不必每次截取 content 首行 |
| `imagesJson` 多图支持 | 灵感可能是一组截图 + 文字，单 imageUrl 不够 |
| `linkDescription` / `linkImage` | 链接型素材需要 OG 信息做富预览卡片 |
| `embedding` 向量字段 | 支持语义检索（@面板输入模糊词也能匹配），初期可空，后期 AI 补填 |
| `aiSummary` 摘要 | @面板候选列表需要高密度信息展示，AI 生成的一句话比 content 截断更有效 |
| `usageCount` 使用计数 | @面板默认按「最近 + 最常用」排序，使用频次是重要信号 |
| `color` 颜色标记 | 卡片视觉区分度，也用于 chip 着色 |
| 字段平铺非嵌套 | 便于 Prisma 查询、索引、AI 工具 select 精确字段 |

### 6.3 标签模型（可选独立表，初期用 JSON 即可）

初期 `tagsJson` 以 JSON 数组存储（`["产品想法", "技术灵感"]`），与 Asset 一致。
后期如需标签管理（颜色、排序、统计），可抽离为独立 `SnippetTag` 表。

### 6.4 引用关系追踪（可选）

```prisma
/// 素材块被文章引用的记录（便于双向溯源：文章用了哪些素材 / 素材被哪些文章用了）
model SnippetUsage {
  id          String   @id @default(cuid())
  snippetId   String
  articleId   String
  insertedVia String   @default("at-mention") // "at-mention" | "drag-drop" | "sidebar"
  createdAt   DateTime @default(now())

  snippet     Snippet  @relation(fields: [snippetId], references: [id], onDelete: Cascade)
  article     Article  @relation(fields: [articleId], references: [id], onDelete: Cascade)

  @@index([snippetId])
  @@index([articleId])
  @@unique([snippetId, articleId]) // 同一素材同一文章只记一条
}
```

---

## 7. API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/snippets` | 列表查询（分页 + 筛选 + 搜索） |
| POST | `/api/snippets` | 创建素材块 |
| PATCH | `/api/snippets/[id]` | 更新素材块 |
| DELETE | `/api/snippets/[id]` | 软删除（移入回收站） |
| POST | `/api/snippets/[id]/pin` | 置顶/取消置顶 |
| GET | `/api/snippets/tags` | 获取所有标签（去重 + 计数） |
| GET | `/api/snippets/search` | @面板专用：轻量快速检索（返回精简字段） |
| POST | `/api/snippets/load` | AI 工具专用：批量加载素材完整内容 |
| POST | `/api/snippets/[id]/usage` | 记录素材被引用（usageCount++） |

### 查询参数（GET /api/snippets）

```
?kind=text|image|quote|link   // 类型筛选
&tag=产品想法                  // 标签筛选（可多个）
&q=搜索关键词                  // 全文搜索
&cursor=xxx                   // 游标分页
&limit=20                     // 每页数量
```

### @面板检索（GET /api/snippets/search）

专为对话框 @触发 设计，强调速度和精简返回：

```
?q=产品                        // 模糊搜索（title + content + tags）
&kind=text                    // 可选类型筛选
&tag=产品想法                  // 可选标签筛选
&limit=8                      // 候选数量（面板最多显示 8 条）
```

返回精简结构（减少传输量）：
```json
{
  "items": [
    {
      "id": "clxxx1",
      "title": "好的产品设计是减法",
      "summary": "张小龙关于产品设计的核心观点…",
      "kind": "quote",
      "tags": ["阅读摘录"],
      "imageUrl": null,
      "color": "amber",
      "updatedAt": "2026-07-05T..."
    }
  ]
}
```

### 批量加载（POST /api/snippets/load）

AI Agent 工具调用时使用：
```json
// Request
{ "ids": ["clxxx1", "clxxx2"] }

// Response
{
  "snippets": [
    {
      "id": "clxxx1",
      "title": "好的产品设计是减法",
      "content": "张小龙曾说：好的产品设计是减法，而不是加法...",
      "kind": "quote",
      "quoteSource": "张小龙",
      "imageUrl": null,
      "tagsJson": "[\"阅读摘录\"]"
    }
  ]
}
```

---

## 8. 文件结构规划

```
src/
├── app/snippets/
│   └── page.tsx                    // 素材块列表页（SSR）
├── components/snippets/
│   ├── SnippetList.tsx             // 瀑布流列表（客户端）
│   ├── SnippetCard.tsx             // 单卡片组件（按 kind 渲染）
│   ├── SnippetCreateBar.tsx        // 顶部内联创建框
│   ├── SnippetEditInline.tsx       // 原地编辑态
│   ├── SnippetQuickDialog.tsx      // 全局快捷弹窗
│   ├── SnippetTagSidebar.tsx       // 标签侧栏
│   ├── SnippetInsertPanel.tsx      // 编辑器侧边栏引用面板（支持拖拽）
│   ├── SnippetMentionPopover.tsx   // @触发的灵感检索浮动面板
│   ├── SnippetChip.tsx             // 对话框内的灵感引用 chip
│   └── SnippetDragItem.tsx         // 可拖拽的灵感卡片（用于侧边栏→编辑区）
├── components/editor/
│   └── snippet-mentions.tsx        // @检测逻辑 + 面板触发 hook（与 slash-commands 平行）
├── app/api/snippets/
│   ├── route.ts                    // GET + POST
│   ├── search/route.ts             // GET @面板快速检索
│   ├── load/route.ts               // POST AI工具批量加载
│   ├── tags/route.ts               // GET 标签列表
│   └── [id]/
│       ├── route.ts                // PATCH + DELETE
│       ├── pin/route.ts            // POST 置顶
│       └── usage/route.ts          // POST 记录引用
├── lib/ai/tools/
│   └── load-snippets.ts            // AI Agent 工具：加载灵感素材
```

---

## 9. 与现有功能的集成点

| 集成点 | 方式 |
|--------|------|
| 首页顶栏导航 | `page.tsx` nav 区域新增「灵感」按钮 |
| 全局搜索 | `GlobalSearch` 组件增加 snippet 搜索结果分类 |
| AI 对话框 @引用 | `WritingAssistant` ChatTextarea 增加 `@` 检测 + SnippetMentionPopover |
| 编辑器拖拽 | 右侧 SnippetInsertPanel（可拖拽卡片列表）→ 编辑区 drop 插入 |
| AI Agent 工具 | 新增 `load_snippets` 工具，agent 解析 `{{snippet:id}}` 占位并加载内容 |
| Agent System Prompt | 消息含 snippet refs 时注入融入规则（风格对齐 + 位置策略） |
| 回收站 | `/recycle` 页面增加「灵感」tab，展示已删除的素材块 |
| 素材库 | 从素材库图片可「一键生成灵感」（图片 + 空白描述） |
| 引用追踪 | SnippetUsage 表双向记录素材↔文章引用关系 |

---

## 10. 实现优先级

### P0 — MVP（核心循环）
1. Prisma model（Snippet + SnippetUsage）+ migration
2. `/api/snippets` CRUD API + `/api/snippets/search` 检索 API
3. `/snippets` 页面 + 瀑布流列表
4. 内联创建框（文字 + 粘贴图片）
5. 顶栏导航入口

### P1 — AI @引用（核心差异化）
6. `@` 触发检测 hook（snippet-mentions.tsx，与 slash-commands 平行）
7. SnippetMentionPopover 检索面板（浮动、键盘导航、实时过滤）
8. SnippetChip 嵌入对话框 + ComposerState segments 管理
9. 发送序列化（snippet refs → `{{snippet:id}}` 占位）
10. `load_snippets` AI 工具 + system prompt 融入规则注入
11. usageCount 引用计数

### P2 — 编辑器直接集成
12. 编辑器侧边栏 SnippetInsertPanel（灵感面板 tab）
13. 拖拽插入编辑区（drag source → drop target + Markdown 映射）
14. 从编辑器选中文字摘录为灵感
15. 标签系统（侧栏 + 筛选 + 颜色）

### P3 — 完善体验
16. 原地编辑（inline editing）
17. 全局快捷键弹窗（`Cmd+Shift+N`）
18. 全局搜索整合
19. AI 自动生成 title / aiSummary（创建时异步填充）
20. embedding 语义向量（支持模糊语义搜索）

### P4 — 增强
21. 标签颜色/排序管理 + SnippetTag 独立表
22. 批量操作（多选删除/打标签）
23. 素材块导出（合并为文章草稿）
24. 移动端适配（响应式瀑布流 → 单列）
25. 链接自动 OG 抓取（linkTitle / linkImage 自动填充）

---

## 11. 设计理念总结

1. **轻量优先**：不做复杂编辑器，textarea + 图片就够了
2. **零摩擦创建**：粘贴即上传、回车即保存，3 秒完成记录
3. **视觉碎片感**：瀑布流而非列表，卡片高度自适应，随意拼贴的感觉
4. **@ 即引用**：对话框中 `@` 一触即达，chip 化引用让灵感自然融入 AI 生成流
5. **AI 风格对齐**：灵感素材不是生硬拼贴，AI 保持原意但调整表述风格与当前文章一致
6. **双路径融入**：@对话框（AI 智能融入）+ 拖拽编辑区（手动精确定位），覆盖不同控制偏好
7. **与写作流打通**：灵感最终要服务于文章创作，引用追踪是双向桥梁
8. **一致性**：`@` 面板与 `/` 命令菜单平行设计，检索面板复用统一浮动样式
