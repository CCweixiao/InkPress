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

## 12. 前端渲染升级

### 12.1 组件

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

### 12.2 渲染规则

- 文本和 reasoning 保留流式体验。
- 工具卡默认一行摘要，展开看 input/output。
- Evidence 默认 chips，超过 3 个收拢。
- 子任务默认折叠，显示类型、最终结论、证据数。
- 审批卡是阻塞 UI，但状态权威在服务端。

---

## 13. 后端可插拔 runtime

### 13.1 Runtime interface

```ts
type AgentRuntime = {
  name: string;
  capabilities: RuntimeCapability[];
  runTurn(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
  resume?(input: AgentResumeInput): AsyncIterable<AgentRuntimeEvent>;
  cancel?(turnId: string): Promise<void>;
};
```

### 13.2 Runtime 适配器

| Adapter | 作用 |
|---|---|
| `ClaudeTsRuntimeAdapter` | 当前 TS `@anthropic-ai/claude-agent-sdk` |
| `ClaudePythonRuntimeAdapter` | 未来 Python service，基于 `claude-agent-sdk-python` |
| `RemoteAgentRuntimeAdapter` | 服务端部署场景，HTTP/SSE 代理 |
| `MockAgentRuntimeAdapter` | UI/E2E 测试 |

前端不得直接依赖某个 SDK 的 message shape，只依赖 `AgentRuntimeEvent`。

---

## 14. 分阶段实施计划

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

## 15. 开发约束

- 不恢复旧 `ToolLoopAgent`。
- 不重新引入外层 LLM 意图 router。
- 不直接开放 SDK 内置 `Read/Edit/Bash`，除非有明确权限、路径和 UI 事件映射。
- 所有新工具必须声明权限、display 和 output shape。
- 所有写入类能力必须走提案或审批。
- 所有外部资料必须产 evidence。
- 所有子任务必须带 `subTaskId`。
- 所有 agent runtime 本地目录必须归属 `~/.inkpress`。

---

## 16. AI 开发者任务提示词

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
7. 所有变更需补 typecheck 和关键 probe/test。
```

---

## 17. 验收总表

| 能力 | 验收标准 |
|---|---|
| 多类型文章 | 至少 4 个 profile 能影响工具/Skill/checklist |
| 可插拔工具 | 新增工具无需改前端 if/else 主链路 |
| Web research | 有审批、有来源、有 evidence chip |
| 子任务 | 子任务可展开，主上下文不被内部历史污染 |
| 权限学习 | 可本次/本会话/长期允许或拒绝 |
| Runtime 可替换 | TS/Python/远程 runtime 可共享事件协议 |
| 打包隔离 | SDK config/cwd 均在 `~/.inkpress/cache/claude-agent` |
| 可观测性 | compact/retry/tool progress/error 都能在对话窗口看到 |

