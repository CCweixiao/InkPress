# 素材块 P3-AI（item 19：AI 摘要）设计

> 日期：2026-07-08
> 分支：`feat/snippets-p3-ai`（从 `feat/snippets-p3-ux` 开 stacked 子分支）
> 范围：路线图 P3-AI 的 **item 19 仅**（创建/编辑时 AI 生成 `aiSummary`）。item 20（embedding 语义检索）留下一轮。

## 目标

创建或编辑素材块时，由 AI 生成一句话 `aiSummary`，供 @面板（`/api/snippets/search`）预览使用，替代当前 `content.slice(0,80)` 的机械截断。

## 背景与现状

- `Snippet` 模型已有 `aiSummary String?` 与 `embedding String?` 字段（`prisma/schema.prisma:507-509`），**本轮无需 migration**。
- `aiSummary` 已有现成消费者：`src/app/api/snippets/search/route.ts` 返回 `summary: s.aiSummary || s.content.slice(0,80)`，@面板据此渲染预览。
- 现有 `title` 由 `POST /api/snippets` 从 content 首行抽取（`data.content.trim().split("\n")[0].slice(0,50) || "无标题"`），机械、确定。
- AI 调用基础设施已就绪：`src/lib/ai/provider.ts` 暴露 `getModel()`，封装 Vercel AI SDK 的 `@ai-sdk/anthropic`，统一走配置供应商（默认智谱 GLM-4.6 via Anthropic 兼容端点）的 `/messages` 协议。可用 `generateText({model, prompt})` 做轻量单次调用，无需启动重型 Claude Agent 循环。
- Next 16 提供 `after()`（`next/server`），可在响应返回后 fire-and-forget 跑后台任务，适合 AI 富化。

## 关键设计决策（已与用户确认）

1. **范围**：本轮只做 item 19（AI 摘要）。item 20（embedding 语义检索）留下一轮。
2. **时机**：**异步 `after()`**。POST/PATCH 立即返回，`after()` 后台生成 `aiSummary` 写回 DB。零创建延迟；下次列表刷新即见。
3. **AI 只生成 `aiSummary`，不改 `title`**：`title` 维持首行抽取，承载用户意图，避免 AI 改写的"惊吓"。字段语义本就分离——`title`=人读卡片标题，`aiSummary`=AI 预览。

## 数据模型

无变更。复用既有字段：

| 字段 | 类型 | 本轮用途 |
|---|---|---|
| `aiSummary` | `String?` | AI 生成的一句话摘要（≤40 字）。`null` 时消费者回落 `content.slice(0,80)` |
| `title` | `String @default("")` | 不变，首行抽取 |

## 架构

```
POST /api/snippets  ──> prisma.create ──> 201 返回（title=首行, aiSummary=null）
                                          │
                                          └─ after() ─> generateAndSaveAiSummary(id)
                                                          │
                                                          ├─ load snippet
                                                          ├─ decideStrategy(s)
                                                          ├─ "ai"  -> generateText -> normalizeAiSummary
                                                          ├─ "copy"-> normalizeAiSummary(linkDescription)
                                                          └─ "skip"-> 不写
                                                          │
                                                          └─ prisma.update({aiSummary})  (吞错)

PATCH /api/snippets/[id] ──> 检测输入字段变化 ──> update ──> 200
                                   │                          │
                                   └─ 变化时 after(...) ───────┘
```

### 模块布局

- **新增** `src/lib/snippets/ai-summary.ts`（服务端专用，`@/lib/ai/provider` + `@/lib/db`）：
  - `decideStrategy(s)`：返回 `"ai" | "copy" | "skip"`（纯函数）
  - `composePromptInput(s)`：拼装送给 LLM 的正文（纯函数）
  - `normalizeAiSummary(raw)`：trim / 去首尾引号 / 截断 ≤40 字（纯函数）
  - `generateAiSummary(s)`：调 `getModel()` + `generateText`，返回 `string | null`（吞错）
  - `generateAndSaveAiSummary(snippetId)`：load → decide → 生成/复制 → update DB（吞错，warn 日志）
- **改** `src/app/api/snippets/route.ts`（POST）：`prisma.snippet.create` 后追加 `after(() => generateAndSaveAiSummary(snippet.id))`
- **改** `src/app/api/snippets/[id]/route.ts`（PATCH）：检测到输入字段变化后 `after(() => generateAndSaveAiSummary(id))`

**客户端 bundle 安全**：`ai-summary.ts` 仅服务端 import（含 prisma + provider），不进 `"use client"` 链路。纯函数虽可拆，但它们只为服务端流程服务，统放一处即可，无需拆 meta/finalize。

## 行为规约

### 跳过 / 策略决策（`decideStrategy`）

按优先级：

| 条件 | 策略 | 动作 |
|---|---|---|
| `kind === "link"` 且 `linkDescription?.trim()` 非空 | `"copy"` | `aiSummary = normalizeAiSummary(linkDescription)`，零 AI 调用 |
| `kind === "image"` | `"skip"` | 不写 aiSummary；@面板由 `content.slice` 兜底（caption 本就短且是用户原意） |
| `content.trim().length < 3` | `"skip"` | 太短不值得调 AI |
| 其他（text / quote / 无 OG 的 link） | `"ai"` | 调 `generateText` 生成 |

### 触发时机

- **创建**：总是 `after(...)` 排队（由 `decideStrategy` 自行决定是否真调 AI）。
- **编辑**：当下列任一字段相对旧值变化时才 `after(...)`：`content`、`kind`、`quoteSource`、`linkTitle`、`linkDescription`。仅改 `tagsJson` / `color` / `pinned` 等不触发（输入未变，旧 aiSummary 仍有效）。

### `composePromptInput`

- text：`content`
- quote：`${content}\n—— ${quoteSource ?? ""}`（去尾空）
- link（无 OG）：`${content}\n链接：${linkTitle ?? linkUrl ?? ""}`（去尾空）
- image / 短文本：不会走到这里（已被 skip）

### AI 调用参数

- 模型：`chooseLlmConfig()` → 全局默认模型（与聊天同源，不新增配置）。
- system prompt（verbatim）：
  > 你是素材整理助手。用一句不超过 30 字的中文概括以下素材的核心，直接输出概括，不要前缀、不要引号、不要解释。
- `max_tokens`：60；`temperature`：0.3。
- 输入安全：`composePromptInput` 结果再截断 ≤ 1000 字，防超长 prompt。

### `normalizeAiSummary`

- `trim()`。
- 去除首尾成对的中文/英文引号（`""` `""` `''` `''`）。
- 截断 ≤ 40 字符。
- 空串 → `null`。

## 错误处理（铁律）

**AI 失败永不阻断创建/编辑。** 所有异常在 `generateAiSummary` / `generateAndSaveAiSummary` 内捕获：

- 未配置供应商（`getModel` 抛错）/ API 报错 / 超时 / 解析失败 → `log.warn`，`aiSummary` 留 `null`。
- 消费者（@面板）自动回落 `content.slice(0,80)`，用户无感知。
- `after()` 在响应返回后执行，其异常不影响已返回的 201/200。

## 并发与陈旧

- 编辑触发的新生成与在途的旧生成可能竞争：**last writer wins**。`aiSummary` 是派生缓存、非权威字段，可接受。
- 不加 content-hash 守卫（YAGNI）。

## 测试边界（TDD = 纯逻辑）

vitest 覆盖 `tests/unit/`：

- `decideStrategy`：text / quote / link(有OG) / link(无OG) / image / 短文本 各路径。
- `composePromptInput`：text / quote(带/不带 source) / link(带/不带 title)。
- `normalizeAiSummary`：普通文本 / 首尾引号 / 超长截断 / 空白 → null。

**不**用 vitest 测：`after()` 接线、`generateText` 实调、API 路由。这些走 typecheck + build + 手测（沿用既有 TDD 边界）。

## 验收（手测）

1. 未配置 AI 供应商 → 创建素材仍成功，aiSummary 留空，@面板显示 content 截断。
2. 配置供应商 → 创建 text 素材 → 刷新列表 → @面板该条 `summary` 为 AI 生成的一句话（非机械截断）。
3. 编辑 content → aiSummary 随之更新；只改标签 → aiSummary 不变。
4. 创建 link（带 linkDescription）→ aiSummary = linkDescription，无 AI 调用。
5. 创建 image → aiSummary 留空，@面板显示 caption。

## 范围外（本轮不做）

- item 20：embedding 语义检索（下一轮）。
- 手动"重新生成摘要"按钮。
- 卡片 AI loading 态（主页面卡片不展示 aiSummary，无需）。
- AI 改写 `title`（用户明确选择维持首行抽取）。
