# InkPress Agent Runtime PDC

> PDC = Product Design Contract。本文面向后续 AI/人类开发者，约定 InkPress Agent Runtime 的产品目标、架构边界、可插拔协议、实现阶段和验收标准。
>
> 背景：InkPress 已迁移到 Claude Agent SDK 作为主 agent loop。本文不主张回退到完全自研 loop，而是吸收 goink `internal/agent` 的优秀工程设计，补强 InkPress 在多类型文章写作、工具可插拔、子任务隔离、事件渲染、权限治理和后端可替换方面的能力。

---

## 1. 设计结论

InkPress 的长期方向应是：

```text
React / Next / Electron UI
  -> Stable Agent Event Protocol
  -> InkPress Agent Runtime Adapter
      -> Claude Agent SDK as main brain
      -> InkPress MCP tools as product capabilities
      -> Permission / approval / session / proposal / evidence
  -> Optional local service layer: Go or Python workers for heavy tools
```

关键原则：

- Claude Agent SDK 负责意图识别、计划、工具循环、长上下文、resume、autocompact。
- InkPress 负责工具、Skill、素材、文章类型、提案审阅、权限、证据、前端渲染和可观测性。
- goink 的自研 loop 不直接照搬，但其事件协议、工具注册表、子 agent 隔离、display 后端生成、死循环保护和 token budget 机制应被吸收。
- 后续如引入 Python/Go runtime，不改变前端协议，只替换 Agent Runtime Adapter。

---

## 2. 从 goink 借鉴什么

### 2.1 借鉴点

| goink 设计 | InkPress 落地方式 |
|---|---|
| `AgentEvent` 统一事件协议 | 收敛 UI parts，形成稳定 `AgentRuntimeEvent` |
| `Agent.Run()` 主/子 agent 复用 | 用 Claude Agent SDK 会话 + InkPress 子任务工具实现 research/review/memory 子任务 |
| `registry.OpenAI(allowedTools)` + `registry.Execute()` 双层守门 | MCP registry 继续作为单一事实源，暴露前和执行前都校验 |
| `buildDisplay(name,args,phase)` 后端生成展示语义 | 在工具 registry 增加 `display` 契约，前端只负责通用渲染 |
| 子 agent `to_api=false`，仅 final report 回主 agent | 子任务内部历史不污染主会话，只以 tool result 注入摘要 |
| `EventSeq` 解决前端乱序 | 所有 streamed data part 带 `seq`，前端按 turn 内序号稳定合并 |
| 连续工具失败和重复只读调用检测 | 在 adapter/permission 层增加 runtime guard |
| token 超阈值触发压缩 | 主路径依赖 SDK autocompact，InkPress 补 UI 可观测和手动 compact |

### 2.2 不照搬点

| goink 做法 | InkPress 不照搬原因 |
|---|---|
| 完全自研 tool loop | Claude Agent SDK 已提供更强的 loop、resume、autocompact、subagent/skill 能力 |
| 直接解析 OpenAI tool calls | InkPress 应统一消费 SDKMessage 和 MCP tool event |
| Wails `EventsEmit` 强绑定 | InkPress 需要 Next/Electron/服务端部署共用 HTTP SSE/WebSocket |
| 业务工具与 loop 强耦合 | InkPress 工具要可插拔，未来可由 TS/Python/Go 实现 |

---

## 3. 当前缺陷与增强目标

### 3.1 当前已具备

- Claude Agent SDK 主链路。
- InkPress MCP 工具注册表。
- Skill 加载工具：`load_skill` / `read_skill_resource`。
- 文章/技术文档提案工具。
- 代码源授权和代码只读工具。
- 工具审批卡、代码源审批卡、retry、compact、tool progress 初步渲染。
- SDK config/cwd 已隔离到 `~/.inkpress/cache/claude-agent/*`。

### 3.2 需要补强

| 缺口 | 风险 | 增强目标 |
|---|---|---|
| 事件协议分散在 UIMessage parts | 后续换后端/加工具会频繁改前端 | 建立稳定 Agent Runtime Event Protocol |
| 工具 display 主要在前端维护 | 新工具需要同时改后端和前端 | display 元数据进入工具 registry |
| 子任务无统一模型 | research/review/memory 容易污染主上下文 | 增加子任务工具和隔离规则 |
| 文章类型只靠自然语言/Skill | 多类型文章写作效果不稳定 | 增加 Article Type Profile |
| Skill 触发只有 prompt hint | 无法表达适用场景、输入、产出、工具偏好 | 增加 Skill manifest 能力字段 |
| 外部检索工具缺失 | “可检索外部资料”不成立 | 增加受控 web_search/web_fetch MCP |
| 权限规则不可学习 | 用户反复审批同类操作 | 增加 suggestedRule 和规则管理 |
| 工具失败/重复调用保护较弱 | agent 卡在工具循环 | 增加 runtime guard 事件和提醒 |
| token/cost 统计只保存 last turn | `/clear` 或消息清理后无法做历史大盘，且中断轮次可能丢用量 | 建立独立 usage ledger，按对话轮次汇总，step 仅作运行时兜底 |
| 打包/服务端后端可替换性不足 | 未来迁 Python/Go 成本高 | 以前端协议稳定化为边界 |

---

## 4. Agent Runtime Event Protocol

目标：前端只认稳定事件，不关心后端是 TS Claude Agent SDK、Python SDK、Go service 还是远程服务。

### 4.1 事件类型

```ts
type AgentRuntimeEvent =
  | AgentTextEvent
  | AgentReasoningEvent
  | AgentTaskEvent
  | AgentToolEvent
  | AgentApprovalEvent
  | AgentEvidenceEvent
  | AgentProposalEvent
  | AgentContextEvent
  | AgentErrorEvent;

type AgentEventBase = {
  turnId: string;
  seq: number;
  ts: string;
  source: "claude-agent-sdk" | "inkpress-runtime" | "tool" | "worker";
  subTaskId?: string;
};
```

### 4.2 Canonical stages

```ts
type AgentStage =
  | "intent"
  | "context"
  | "plan"
  | "reasoning"
  | "tool"
  | "approval"
  | "evidence"
  | "proposal"
  | "context-compact"
  | "error";
```

前端渲染按 stage 分组，但同一 stage 内按 `seq` 稳定排序。已有 UIMessage parts 可以先由 adapter 映射到这个协议，再逐步替换直接渲染分支。

### 4.3 Tool event

```ts
type AgentToolEvent = AgentEventBase & {
  kind: "tool";
  stage: "tool";
  toolName: string;
  toolCallId: string;
  phase:
    | "selected"
    | "executing"
    | "awaiting_approval"
    | "completed"
    | "failed"
    | "cancelled"
    | "loop_detected";
  input?: unknown;
  output?: unknown;
  error?: string;
  display: ToolDisplay;
};

type ToolDisplay = {
  title: string;
  activityKind:
    | "skill"
    | "read"
    | "write"
    | "search"
    | "web"
    | "review"
    | "plan"
    | "proposal"
    | "approval"
    | "general";
  summary?: string;
  icon?: string;
  metadata?: Record<string, unknown>;
};
```

### 4.4 Approval event

```ts
type AgentApprovalEvent = AgentEventBase & {
  kind: "approval";
  stage: "approval";
  approvalId: string;
  approvalType: "tool" | "code_source" | "plan" | "external_network" | "write";
  title: string;
  description: string;
  payload: unknown;
  suggestedRule?: SuggestedPermissionRule;
  critical?: boolean;
};
```

### 4.5 Evidence event

```ts
type AgentEvidenceEvent = AgentEventBase & {
  kind: "evidence";
  stage: "evidence";
  evidenceType:
    | "source_file"
    | "git_commit"
    | "git_range"
    | "web_source"
    | "asset"
    | "project_snapshot";
  title: string;
  locator?: string;
  url?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};
```

---

## 5. Tool Plugin Contract

InkPress MCP tools 必须变成可插拔的 product capability，而不是散落的 handler。

### 5.1 Tool definition

```ts
type InkPressToolDefinition = {
  name: string;
  version: string;
  description: string | ((ctx: ToolContext) => string);
  category:
    | "skill"
    | "article"
    | "technical-document"
    | "asset"
    | "code"
    | "git"
    | "web"
    | "memory"
    | "subtask";
  inputSchema: ZodRawShape;
  outputSchema?: ZodRawShape;
  permission: PermissionPolicy;
  display: ToolDisplayFactory;
  evidence?: EvidenceEmitter;
  execute: ToolExecutor;
};
```

### 5.2 Permission policy

```ts
type PermissionPolicy = {
  default: "allow" | "ask" | "deny";
  readOnly: boolean;
  critical?: boolean;
  ruleKey?: string;
  matchRule?: (input: unknown, rule: PermissionRule) => boolean;
  builtInCheck?: (input: unknown, ctx: ToolContext) => PermissionDecision;
};
```

要求：

- 未知工具默认 `ask`。
- 代码源、Web、写回、发布类工具必须有 `ruleKey`。
- 所有文件/路径类工具必须有 `builtInCheck`。
- `execute` 内部仍要二次检查权限和数据边界，不能只依赖模型上下文隐藏。

### 5.3 后端 display 生成

每个工具必须定义 display factory：

```ts
type ToolDisplayFactory = (input: {
  phase: AgentToolEvent["phase"];
  args?: unknown;
  output?: unknown;
  error?: string;
  ctx: ToolContext;
}) => ToolDisplay;
```

这样前端只写通用 `ToolActivityCard`，新增工具不需要追加大量 if/else。

---

## 6. 子任务模型

### 6.1 子任务类型

```ts
type SubTaskType =
  | "research"
  | "review"
  | "outline"
  | "fact_check"
  | "style_adapt"
  | "technical_analysis"
  | "asset_selection";
```

### 6.2 子任务工具

新增 MCP 工具：

```text
mcp__inkpress__run_subtask
```

输入：

```ts
type RunSubtaskInput = {
  type: SubTaskType;
  instruction: string;
  contextRefs?: Array<{
    type: "article" | "asset" | "source_file" | "web_source" | "skill";
    id?: string;
    locator?: string;
  }>;
  allowedTools?: string[];
  maxTurns?: number;
};
```

输出：

```ts
type RunSubtaskOutput = {
  subTaskId: string;
  finalText: string;
  evidence: AgentEvidenceEvent[];
  usage?: Record<string, unknown>;
};
```

### 6.3 隔离规则

- 子任务内部消息不进入主会话长期上下文。
- 主 agent 只看到 `finalText + evidence summary`。
- 前端可以展开子任务轨迹，但默认折叠。
- 子任务的 tool events 必须带 `subTaskId`。
- 子任务失败不直接终止主任务，除非工具声明 `critical`。

### 6.4 Claude Agent SDK 落地方式

优先级：

1. 若 SDK subagent / Agent 工具稳定可用，映射到 SDK 原生子 agent。
2. 否则由 InkPress runtime 发起独立 Claude Agent SDK query，使用同一 MCP server 但不同 system prompt 和 tool allowlist。
3. 子任务 transcript 可独立存储到 `ClaudeAgentSessionEntry.subpath`。

---

## 7. Article Type Profile

目标：方便后续支持各种类型文章编写，而不是只靠一段泛 prompt。

### 7.1 Profile 定义

```ts
type ArticleTypeProfile = {
  id: string;
  name: string;
  description: string;
  intentHints: string[];
  defaultSkills: string[];
  requiredSections?: string[];
  optionalSections?: string[];
  tonePresets: string[];
  evidencePolicy: "none" | "light" | "required" | "strict";
  assetPolicy: "none" | "optional" | "recommended" | "required";
  webPolicy: "disabled" | "ask" | "allowed";
  proposalTool: "propose_article_revision" | "propose_technical_document_revision";
  outputChecklist: string[];
};
```

### 7.2 内置 profiles

建议首批内置：

| id | 用途 | 默认能力 |
|---|---|---|
| `wechat_essay` | 公众号观点/经验文章 | Skill + 素材，可选 Web |
| `technical_deep_dive` | 技术深度解析 | 代码源 + Git + Web + evidence required |
| `product_update` | 产品更新/版本说明 | Git range + change summary |
| `case_study` | 案例复盘 | Web + 素材 + structured outline |
| `tutorial` | 教程/操作指南 | step outline + screenshots/assets |
| `news_commentary` | 热点评论 | Web required + source evidence |
| `architecture_doc` | 技术架构文档 | code tools + technical proposal |
| `api_doc` | API/模块说明 | code search/read + source references |

### 7.3 Profile 接入点

- 新建文章时可选择文章类型；未选择则由 agent 自判。
- `system-prompt.ts` 注入当前 profile。
- `load_skill` 优先提示 profile 的 `defaultSkills`。
- Web/代码/素材工具是否可用，受 profile policy 和权限规则共同决定。
- 提案卡显示 profile checklist，帮助用户审稿。

---

## 8. Skill Manifest 增强

当前 Skill 主要是 `SKILL.md` 文本。为了可插拔，需要补充机器可读 manifest。

### 8.1 manifest

```json
{
  "id": "technical-deep-dive",
  "name": "技术深度文章",
  "description": "帮助撰写有代码证据的技术深度文",
  "appliesTo": ["technical_deep_dive", "architecture_doc"],
  "triggers": ["源码分析", "架构", "调用链", "性能优化"],
  "requiredTools": ["project_search", "project_read"],
  "optionalTools": ["git_log", "web_search"],
  "outputContract": {
    "requiresEvidence": true,
    "requiresOutline": true,
    "proposalKind": "technical-document"
  },
  "resources": [
    { "path": "references/checklist.md", "description": "审稿清单" }
  ]
}
```

### 8.2 加载策略

- system prompt 只注入 Skill 摘要和 manifest 关键信息。
- 完整手册仍通过 `load_skill` 读取。
- `read_skill_resource` 必须校验资源在 manifest 中声明。
- 用户斜杠命令 `/skill` 只作为 preferred hint，不替代 Claude Agent 自主选择。

---

## 9. Web Research Capability

当前缺口：未接 Web MCP，且 SDK 内置工具禁用，因此 agent 不能真正检索外部资料。

### 9.1 新增工具

```text
mcp__inkpress__web_search
mcp__inkpress__web_fetch
```

### 9.2 权限

| 工具 | 默认 | 规则 |
|---|---|---|
| `web_search` | ask | 可按 provider/domain/session 记忆 |
| `web_fetch` | ask | 域名级 suggestedRule |

### 9.3 输出要求

Web 工具必须返回结构化来源：

```ts
type WebSource = {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  fetchedAt: string;
  sourceType?: "official" | "news" | "blog" | "docs" | "paper" | "unknown";
};
```

前端渲染为 `EvidenceChip`，提案正文中引用外部事实时必须能回溯到 source。

---

## 10. Permission Learning

借鉴 goink 的审批事件和 AgentScope 式规则系统，补齐 InkPress 可学习权限。

### 10.1 PermissionRule

```ts
type PermissionRule = {
  id: string;
  scope: "session" | "workspace" | "global";
  toolName: string;
  behavior: "allow" | "deny" | "ask";
  matcher: Record<string, unknown>;
  description: string;
  createdAt: string;
  expiresAt?: string;
};
```

### 10.2 SuggestedRule

每次 ASK 时后端生成：

```ts
type SuggestedPermissionRule = {
  toolName: string;
  scopeOptions: ["session", "workspace", "global"];
  matcher: Record<string, unknown>;
  description: string;
};
```

审批卡支持：

- 仅本次允许。
- 本会话自动允许。
- 对当前代码源/域名长期允许。
- 拒绝并记住。

---

## 11. Context 与 Session

### 11.1 分层上下文

| 层 | 来源 | 进入 Claude Agent 的方式 |
|---|---|---|
| Current target | 当前文章/技术文档实时内容 | system prompt 动态段，超长截断 |
| Conversation | Claude Agent SDK sessionStore | SDK resume/autocompact |
| Product memory | 用户偏好、文章类型、历史提案 | MCP 工具按需读取 |
| Code source | 授权后的项目/Git/GitHub | MCP 工具按需读取 |
| External sources | Web search/fetch | MCP 工具按需读取并产 evidence |
| Subtask memory | 子任务 transcript | 不进主上下文，只注入 final summary |

### 11.2 Compact 可观测

前端需要展示：

- 正在压缩。
- 压缩完成。
- pre/post tokens。
- trigger：auto/manual。
- 压缩摘要可展开，但默认不打扰。

### 11.3 路径隔离

Claude Agent SDK runtime 必须固定：

```text
~/.inkpress/cache/claude-agent/config
~/.inkpress/cache/claude-agent/workspace
```

不得读写用户 `~/.claude`，不得把当前项目仓库作为 SDK 默认 cwd。

---

## 12. Token 成本跟踪与消耗大盘

目标：把 Claude Agent SDK 的 token/cost 信息变成 InkPress 自己可审计、可聚合、可展示的 usage ledger。聊天窗口只做轻量反馈，不遮挡主输出；完整分析放到设置页“Token 消耗”大盘。

### 12.1 官方语义边界

必须遵守 Claude Agent SDK 的成本跟踪语义：

- `query()` 是单次 SDK 调用边界，调用结束时产出一条 `result` 消息。
- 单个 `query()` 可能包含多个 assistant step。assistant 消息上的 `message.message.usage` 可用于 step 级 token 采集。
- 并行工具调用可能让同一个 step 产生多条 assistant 消息，这些消息共享同一个 `message.message.id`，必须按 id 去重。
- `result.usage` 和 `result.total_cost_usd` 是单次 `query()` 的最终汇总；成功和错误 `result` 都要计入。
- `resume` 串起的是 Claude 会话上下文，不是成本账本。多轮对话成本必须由 InkPress 自己按 turn 聚合。
- `total_cost_usd` / `modelUsage.costUSD` 是 SDK 本地估算，只能用于产品可观测和预算提示，不作为权威计费。

### 12.2 产品原则

- 只持久化每个对话轮次的汇总，不持久化每个 step 的明细。
- step usage 只在运行时内存中维护，作为中断、退出、没有收到 `result` 时的 fallback。
- `/clear` 只清聊天消息、当前上下文和前端 token meter，不清 usage ledger。
- token 统计独立于 `AgentChatMessage` 生命周期；删除消息、清理会话、压缩上下文不应影响历史消耗统计。
- 设置页提供单独“清空 token 统计”入口，必须二次确认。
- 删除文章/技术文档后，历史统计仍保留；目标可显示为“已删除文章/文档”。

### 12.3 数据模型

新增独立事实表 `AgentUsageTurn`，作为 token/cost 统计唯一事实来源：

```prisma
model AgentUsageTurn {
  id                       String   @id @default(cuid())
  sessionId                String
  turnId                   String
  targetKind               String   // article | technical-document
  targetId                 String
  providerId               String?
  modelId                  String?
  sdkSessionId             String?
  inputTokens              Int      @default(0)
  outputTokens             Int      @default(0)
  cacheReadInputTokens     Int      @default(0)
  cacheCreationInputTokens Int      @default(0)
  totalTokens              Int      @default(0)
  costUsd                  Float    @default(0)
  status                   String   @default("completed") // completed | partial | error
  source                   String   @default("sdk-result") // sdk-result | step-fallback
  modelUsageJson           String   @default("{}")
  metadataJson             String   @default("{}")
  startedAt                DateTime @default(now())
  finishedAt               DateTime?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@unique([sessionId, turnId])
  @@index([sessionId, startedAt])
  @@index([targetKind, targetId, startedAt])
  @@index([modelId, startedAt])
  @@index([status, startedAt])
}
```

保留 `AgentChatSession.lastInputTokens/lastOutputTokens/lastTotalTokens` 作为最后一轮快捷显示字段，但它们不是历史统计事实源。

### 12.4 运行时采集

`createSdkToUiAdapter` 内维护一个轻量 usage collector：

```ts
type RuntimeStepUsage = {
  messageId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

type AgentTurnUsageSummary = {
  turnId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalTokens: number;
  costUsd: number;
  modelUsage: Record<string, unknown>;
  status: "completed" | "partial" | "error";
  source: "sdk-result" | "step-fallback";
};
```

采集规则：

- 收到 `assistant` 消息时，读取 `message.message.id` 和 `message.message.usage`。
- 同一 `messageId` 只计一次；若同 id 的 output token 不一致，保留最大值。
- 收到 `result` 消息时，以 `result.usage`、`result.total_cost_usd`、`result.modelUsage` 作为最终 turn summary。
- 如果 stream 结束、请求 abort、页面退出或 runtime 抛错时没有 `result`，用内存中的去重 step usage 求和，保存 `status=partial`、`source=step-fallback`。
- 如果收到错误 `result`，仍保存 usage，`status=error`、`source=sdk-result`。
- 如果没有任何 SDK usage，不写统计；若产品需要失败审计，可写 `status=partial` 且 token 为 0，但默认不写。

### 12.5 重试与中断

一个用户轮次可能包含多个 SDK attempt，例如限流后整轮重试。

- 每个用户发送请求生成一个应用级 `turnId`。
- 正常情况下：一个 `turnId` 对应一个 SDK `query()`，以 result 汇总为准。
- 限流/错误重试时：同一个 `turnId` 下可能有多个 attempt。若失败 attempt 已产生 result usage，也要累加进该用户轮次。
- 若前一个 attempt 只产生 step fallback，后一个 attempt 成功，则最终 `AgentUsageTurn` 应合并两部分成本，并在 `metadataJson` 中保留 attempts 摘要。
- 若同一 `turnId` 先写入 `partial`，后续恢复拿到 `result`，应 upsert 更新为 `completed`，避免重复计费。

### 12.6 `/clear` 与统计生命周期

`/clear` 的产品语义必须明确：

| 操作 | 清理内容 | 不清理内容 |
|---|---|---|
| `/clear` | UI 消息、当前上下文、composer token meter、当前 Claude resume 入口（按既有会话语义） | `AgentUsageTurn` 历史流水、设置页大盘聚合 |
| 删除会话消息 | `AgentChatMessage` | `AgentUsageTurn` |
| 删除文章/技术文档 | 业务内容和关联聊天 | 历史 usage，可显示为已删除目标 |
| 清空 token 统计 | `AgentUsageTurn` | 文章、消息、Claude session |

因此 token 大盘的累计值不会因为 `/clear` 归零。若用户需要归零，必须走设置页的独立清空统计动作。

### 12.7 聊天窗口轻量 UI

聊天窗口不做大面积统计卡片，只在每条 assistant 回复底部右侧显示低存在感 chip：

```text
12.4K tokens · $0.03
```

交互规则：

- 默认只显示总 token 和估算成本，颜色使用低对比灰色。
- hover 后显示浮层：输入、输出、cache read、cache creation、模型、状态。
- 流式过程中显示 `统计中...`，不占主输出高度。
- `partial` 状态显示 `估算` 标记，例如 `9.8K tokens · 估算`。
- 错误 result 显示 `已计入错误消耗`，避免用户误以为失败不消耗。
- 不在每个 agent step、工具卡、子任务卡上显示 token，避免统计噪音遮盖主输出。

### 12.8 设置页 Token 消耗大盘

设置页新增一级导航：`Token 消耗`。

页面布局：

1. KPI 横条
   - 累计 Token 数
   - 近 7 天 Token
   - 峰值单轮 Token
   - 累计估算成本
   - 当前连续使用天数
   - 会话总数

2. 主趋势图
   - 时间筛选：`当日`、`近7天`、`近30天`、自定义日期。
   - 维度切换：`模型用量`、`会话用量`、`成本`。
   - 折线按模型或目标聚合 token/cost。
   - tooltip 展示 input/output/cache/cost/status 统计。

3. 活动热力图
   - 类似日历热力图展示每日 token 活跃度。
   - 切换：`每日`、`每周`、`累计`。
   - 点击某天后，下方明细表过滤到当天。

4. 洞察区
   - 最常用模型。
   - token 消耗最高的文章/技术文档。
   - 平均每轮 token。
   - cache 命中占比。
   - 中断估算轮次数。
   - 成本最高的最近 10 轮。

5. 明细表
   - 时间。
   - 目标文章/技术文档。
   - 模型。
   - 输入 token。
   - 输出 token。
   - cache read/create。
   - 总 token。
   - 估算成本。
   - 状态：完成 / 中断估算 / 错误完成。

### 12.9 API 与聚合

建议新增只读接口：

- `GET /api/ai/usage/summary?range=7d|30d|custom&from=&to=`
- `GET /api/ai/usage/timeseries?bucket=hour|day|week&groupBy=model|target|status`
- `GET /api/ai/usage/heatmap?from=&to=`
- `GET /api/ai/usage/turns?from=&to=&modelId=&targetId=&status=&limit=&cursor=`

建议新增危险操作接口：

- `DELETE /api/ai/usage`：清空 token 统计，必须二次确认。

聚合口径：

- `totalTokens = inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens`。
- 成本趋势优先用 `costUsd` 求和。
- cache 命中占比：`cacheReadInputTokens / totalTokens`。
- 峰值单轮：按 `AgentUsageTurn.totalTokens` 最大值。
- 连续使用天数：按有非零 token turn 的自然日计算。

### 12.10 验收标准

- 正常 result 能保存一条 `AgentUsageTurn`，包含 token、cost、modelUsage。
- 中断/abort 时，若已有 assistant usage，能保存 `partial + step-fallback`。
- 同一 assistant `messageId` 的并行工具消息不会重复计数。
- `/clear` 后聊天清空，但 Token 消耗大盘累计值不变。
- 删除消息或文章后，历史 usage 仍可聚合。
- 设置页支持近 7 天、近 30 天、模型维度、日期热力图和明细表。
- 聊天窗口 token chip 不遮挡主输出，`partial/error` 状态可识别。

---

## 13. 前端渲染升级

### 13.1 组件

建议新增/重构：

| 组件 | 职责 |
|---|---|
| `AgentTurnTimeline` | 单轮按 stage 渲染 |
| `AgentStageGroup` | 阶段折叠/计数/状态 |
| `ToolActivityCard` | 通用工具卡，消费后端 display |
| `ApprovalGateCard` | 统一 code/tool/web/plan/write 审批 |
| `EvidenceRail` | 收拢 evidence chips |
| `SubTaskCard` | 子任务轨迹折叠展示 |
| `ContextCompactCard` | autocompact 可观测 |
| `ArticleProfileBadge` | 当前文章类型和 checklist |

### 13.2 渲染规则

- 文本和 reasoning 保留流式体验。
- 工具卡默认一行摘要，展开看 input/output。
- Evidence 默认 chips，超过 3 个收拢。
- 子任务默认折叠，显示类型、最终结论、证据数。
- 审批卡是阻塞 UI，但状态权威在服务端。

---

## 14. 后端可插拔 runtime

### 14.1 Runtime interface

```ts
type AgentRuntime = {
  name: string;
  capabilities: RuntimeCapability[];
  runTurn(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
  resume?(input: AgentResumeInput): AsyncIterable<AgentRuntimeEvent>;
  cancel?(turnId: string): Promise<void>;
};
```

### 14.2 Runtime 适配器

| Adapter | 作用 |
|---|---|
| `ClaudeTsRuntimeAdapter` | 当前 TS `@anthropic-ai/claude-agent-sdk` |
| `ClaudePythonRuntimeAdapter` | 未来 Python service，基于 `claude-agent-sdk-python` |
| `RemoteAgentRuntimeAdapter` | 服务端部署场景，HTTP/SSE 代理 |
| `MockAgentRuntimeAdapter` | UI/E2E 测试 |

前端不得直接依赖某个 SDK 的 message shape，只依赖 `AgentRuntimeEvent`。

---

## 15. 分阶段实施计划

### P0：协议冻结

- 新增 `AgentRuntimeEvent` 类型定义。
- 在现有 adapter 中生成 `seq`。
- 写 UIMessage parts 到 AgentRuntimeEvent 的映射表。
- 不改变用户可见功能。

验收：

- 现有聊天流、工具卡、审批卡、提案卡表现不退化。
- 同一 turn 的事件有单调递增 `seq`。

### P1：工具 display registry

- 扩展 `INKPRESS_TOOLS`，增加 `category`、`version`、`display`、`outputSchema`。
- 前端 `tool-helpers.tsx` 逐步退化为兜底。
- 新增 `ToolActivityCard`。

验收：

- 新增工具只改 registry 即可显示合理标题和 activity kind。

### P1.5：Token usage ledger 与大盘

- 新增 `AgentUsageTurn` 表和 migration。
- adapter/runtime 采集 `result.usage`、`total_cost_usd`、`modelUsage`。
- adapter 运行时维护 assistant step 去重汇总，仅作为中断 fallback，不持久化 step 明细。
- route 按 `turnId` upsert `AgentUsageTurn`，并继续更新 `AgentChatSession.last*Tokens`。
- `/clear` 不删除 usage ledger。
- 聊天 assistant 消息底部增加轻量 token chip。
- 设置页新增 `Token 消耗` 导航和大盘页面。

验收：

- 正常、错误、中断三种轮次都有正确 usage 记录。
- `/clear` 后大盘累计不变。
- 大盘支持 KPI、趋势图、热力图、洞察和明细表。

### P2：Web research

- 增加 `web_search` / `web_fetch` MCP 工具。
- 增加域名级审批和 evidence 输出。
- 提案中可回溯 Web source。

验收：

- 用户要求“查最新资料”时，agent 能请求 Web 审批并展示来源。

### P3：Article Type Profile

- 新增 profile 定义和内置 profiles。
- 设置/新建文章接入 profile。
- system prompt 和提案 checklist 注入 profile。

验收：

- 技术深度文、新闻评论、教程、产品更新至少 4 类能走不同默认工具/Skill/checklist。

### P4：Subtask

- 新增 `run_subtask` 工具。
- 支持 research/review/fact_check 三类子任务。
- 子任务事件带 `subTaskId`，前端折叠展示。

验收：

- 子任务内部工具调用不进入主上下文。
- 主 agent 只看到 final report。

### P5：Permission learning

- 新增 PermissionRule 表/存储。
- 审批卡支持 suggestedRule。
- 设置页支持查看/删除规则。

验收：

- 同一代码源/Web 域名可被会话或长期信任，后续不重复弹窗。

### P6：Runtime adapter 抽象

- 抽出 `AgentRuntime` interface。
- 当前 TS SDK 实现为一个 adapter。
- 增加 mock adapter 用于 UI 测试。

验收：

- 前端和 route 不直接引用 SDKMessage shape。
- 后续 Python/Go runtime 可通过同一事件协议接入。

---

## 16. 开发约束

- 不恢复旧 `ToolLoopAgent`。
- 不重新引入外层 LLM 意图 router。
- 不直接开放 SDK 内置 `Read/Edit/Bash`，除非有明确权限、路径和 UI 事件映射。
- 所有新工具必须声明权限、display 和 output shape。
- 所有写入类能力必须走提案或审批。
- 所有外部资料必须产 evidence。
- 所有子任务必须带 `subTaskId`。
- 所有 agent runtime 本地目录必须归属 `~/.inkpress`。
- token/cost 统计必须写入独立 usage ledger，不依赖 `AgentChatMessage` 是否存在。
- `/clear` 不得删除 usage ledger；清空 token 统计必须是设置页独立危险操作。
- 不持久化 step 级 usage 明细；step usage 只可作为中断 fallback 的运行时输入。

---

## 17. AI 开发者任务提示词

后续 AI 开发可使用以下工作入口：

```text
阅读 docs/agent-runtime-pdc.md、docs/agent-engines.md、docs/agent-ui-redesign.md。
目标：按 P0-P6 阶段逐步增强 InkPress Agent Runtime。
原则：
1. Claude Agent SDK 是主 agent loop，不恢复自研 ToolLoopAgent。
2. 前端只依赖 AgentRuntimeEvent，不依赖 SDK 原始消息。
3. 工具能力必须通过 InkPress MCP registry 声明。
4. 新增工具必须带 permission/display/evidence/output contract。
5. 子任务内部历史不得污染主会话。
6. Web/代码/写入类能力必须走权限系统。
7. token/cost 统计必须使用独立 usage ledger；/clear 不能清历史统计。
8. 所有变更需补 typecheck 和关键 probe/test。
```

---

## 18. 验收总表

| 能力 | 验收标准 |
|---|---|
| 多类型文章 | 至少 4 个 profile 能影响工具/Skill/checklist |
| 可插拔工具 | 新增工具无需改前端 if/else 主链路 |
| Token 消耗大盘 | 每轮汇总持久化，`/clear` 不清统计，设置页可查看 KPI/趋势/热力图/明细 |
| Web research | 有审批、有来源、有 evidence chip |
| 子任务 | 子任务可展开，主上下文不被内部历史污染 |
| 权限学习 | 可本次/本会话/长期允许或拒绝 |
| Runtime 可替换 | TS/Python/远程 runtime 可共享事件协议 |
| 打包隔离 | SDK config/cwd 均在 `~/.inkpress/cache/claude-agent` |
| 可观测性 | compact/retry/tool progress/error 都能在对话窗口看到 |
