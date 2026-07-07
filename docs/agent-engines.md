# Claude Agent 封装层设计:InkPress Agent Runtime

> 范围:InkPress 写作助手 AI 对话子系统。
> 目标:不再从 0 自研一套长期并行的 Agent 引擎,而是以 **Claude Agent SDK** 作为 InkPress 的主 Agent Runtime。InkPress 的核心价值聚焦在:Skill 管理、工具封装、权限治理、内容/素材/项目上下文注入、对话框前端渲染、提案审阅与写作工作流体验。
> 落地策略:后续新开分支实施。当前 `writing-agent` 仅作为迁移期 legacy/fallback,不再按“双引擎对等”继续扩建。
> 技术依据:Claude Agent SDK(`@anthropic-ai/claude-agent-sdk`)、Claude Agent SDK 官方文档、happyclaw 工程实践(见附录)。

> 命名合规:依 Anthropic Branding Guidelines,InkPress 产品内不得使用 "Claude Code" / "Claude Code Agent" 作为功能名或视觉元素。产品侧统一称 **"Claude Agent"** 或 **"Powered by Claude"**;`Claude Agent SDK` 作为包名和技术事实可保留。

---

## 决策快照

| 决策项 | 结论 |
|--------|------|
| 产品定位 | InkPress 不做通用 Agent 引擎竞争者,做 Claude Agent 的写作产品封装层 |
| 引擎路线 | **Claude Agent SDK 为唯一主引擎**;现有 Native `writing-agent` 仅迁移期保留 |
| 是否多引擎 | 不做面向用户的“双引擎选择”;不维护两套长期能力闭环 |
| InkPress 价值 | Skill 管理、InkPress 工具 MCP 化、前端渲染、权限/审批、写作提案、素材/正文/项目上下文 |
| 上下文管理 | 使用 Claude Agent SDK 的 autocompact / SessionStore / hooks;InkPress 只做可观测展示 |
| 工具体系 | InkPress 工具统一封装为 `mcp__inkpress__*`;Claude Agent 内置工具按权限策略开放 |
| Skill 体系 | InkPress 继续管理系统/用户 Skill,通过 MCP `load_skill` + 可选 SDK skills 目录接入 |
| 前端体验 | 重点做流式文本、工具卡片、审批卡片、澄清问答、证据块、提案 diff 的高质量渲染 |
| 代码落地 | 建议新开分支,按“封装层迁移”路线逐步替换现有 `writing-agent` |
| 第三方模型 | 不承诺 Anthropic Messages 兼容端点直连 SDK;优先官方/Bedrock/Vertex/Foundry 或 gateway |

---

## 1. 为什么不继续做多引擎

### 1.1 原“双引擎对等”方案的问题

原方案假设 Native Engine 与 Claude Agent Engine 长期并存,并在 UI 中让用户选择。但这会带来很高的长期成本:

- **能力追赶成本高**:Claude Agent 已经具备成熟的工具循环、上下文治理、hooks、permissions、subagents、skills、session persistence。InkPress 自研很难长期追平。
- **两套语义难一致**:同一个 Skill、同一个工具、同一段历史,在 Native 与 Claude Agent 下会有不同的上下文压缩、工具调度和恢复行为。
- **测试矩阵翻倍**:写作、润色、调研、项目探索、代码变更分析、提案创建、审批、resume 都要验证两遍。
- **产品心智复杂**:用户真正想要的是更好的写作助手体验,不是理解“该选哪个引擎”。
- **资源分散**:自研引擎会消耗本该投入在 InkPress 差异化体验上的精力。

### 1.2 新结论

InkPress 不需要和 Claude Agent 比“谁更会做 Agent”。更合理的定位是:

> Claude Agent 负责“怎么思考、怎么调用工具、怎么管理长上下文”。
> InkPress 负责“给它什么 Skill、什么工具、什么内容上下文,以及如何把过程和结果变成优秀的写作产品体验”。

因此本文改为 **Claude Agent 主引擎 + InkPress 封装层** 设计。

---

## 2. 新总体架构

```
┌────────────────────────────────────────────────────────────┐
│ InkPress 前端                                               │
│ - WritingAssistant 对话框                                   │
│ - Tool / Evidence / Approval / Clarify / Proposal 渲染        │
│ - 编辑器正文、素材库、技术文档、代码图谱页面                   │
└───────────────────────────┬────────────────────────────────┘
                            │ UIMessage stream
                            ▼
┌────────────────────────────────────────────────────────────┐
│ /api/ai/chat                                                │
│ - 读取 target 当前正文/文档                                  │
│ - 合并并持久化 UIMessage 历史                                │
│ - 意图轻量预处理:能力问答、误触、空正文等                     │
│ - 组装 Claude Agent Runtime 输入                             │
└───────────────────────────┬────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│ InkPress Agent Runtime                                      │
│                                                            │
│  buildSystemPrompt                                         │
│  buildInkPressMcpServer(mcp__inkpress__*)                  │
│  permission-engine(ALLOW / DENY / ASK)                     │
│  stream-adapter(SDK message -> UIMessage parts)            │
│  session-store(SQLite/Prisma backed)                       │
│  provider-backend env builder                              │
└───────────────────────────┬────────────────────────────────┘
                            │ query()
                            ▼
┌────────────────────────────────────────────────────────────┐
│ Claude Agent SDK                                            │
│ - tool loop                                                 │
│ - built-in tools(Read/Grep/Glob/WebFetch/WebSearch/...)     │
│ - AskUserQuestion                                           │
│ - hooks / permissions                                       │
│ - autocompact                                               │
│ - SessionStore / resume                                     │
│ - subagents / skills                                        │
└────────────────────────────────────────────────────────────┘
```

关键变化:

- 不再设计 `engineRegistry` 作为长期双引擎产品能力。
- 后端模块命名建议使用 `agent-runtime` 或 `claude-agent-runtime`,而不是 `engines/native + engines/agent-sdk`。
- 现有 `writing-agent.ts` 的工具和 prompt 资产要迁移到 runtime 封装层,最终由 Claude Agent SDK 消费。

---

## 3. InkPress 的职责边界

### 3.1 InkPress 应该做什么

| 能力 | InkPress 职责 |
|------|---------------|
| Skill 管理 | 管理系统 Skill、用户 Skill、Skill 资源文件、Skill 生成/编辑/上传 |
| 工具封装 | 把文章/文档/素材/项目/提案能力封装为 `mcp__inkpress__*` |
| 上下文注入 | 注入当前文章、技术文档、素材目录、代码源、项目快照、路由意图 |
| 权限治理 | 对文件/命令/写回/提案/外部访问做 ALLOW/DENY/ASK |
| 前端体验 | 渲染文本、工具调用、证据、审批、澄清、diff、进度、错误 |
| 持久化 | 保存 UIMessage、Claude Agent session id、审批记录、提案记录 |
| 写作工作流 | 把 Claude Agent 输出转成 InkPress 的提案、摘要、素材插图和技术文档版本 |
| 打包配置 | Electron/Next 环境下正确注入 Claude Agent backend env |

### 3.2 InkPress 不应该继续投入什么

| 不建议继续做 | 原因 |
|--------------|------|
| 自研 ToolLoopAgent 长期扩建 | Claude Agent SDK 已覆盖更成熟的循环能力 |
| 自研上下文压缩策略作为主链路 | SDK autocompact 更接近 Claude Agent 内核行为 |
| 双引擎效果一致性 | 成本高,且用户收益有限 |
| 面向用户暴露“引擎选择” | 增加心智负担;默认给最佳体验即可 |
| 自研 subagent 框架 | 优先映射到 SDK subagents / Agent 工具 |

---

## 4. 当前架构如何迁移

### 4.1 当前链路

InkPress 当前链路集中在 `src/app/api/ai/chat/route.ts`:

```
POST /api/ai/chat
  -> getOrCreateAgentSession
  -> mergeAndPersistMessages
  -> routeAgentRequest
  -> prepareAgentContext
  -> createWritingAgent
  -> ToolLoopAgent.stream
  -> toUIMessageStream
  -> onFinish persist
```

迁移后的主链路:

```
POST /api/ai/chat
  -> getOrCreateAgentSession
  -> mergeAndPersistMessages
  -> buildRuntimeInput
  -> createClaudeAgentRuntime
  -> query({ options })
  -> agent-sdk-stream-adapter
  -> onFinish persist
```

### 4.2 模块迁移表

| 当前模块 | 新角色 | 处理方式 |
|----------|--------|----------|
| `src/lib/ai/writing-agent.ts` | legacy/fallback | 不继续扩建;逐步把工具和 prompt 迁出 |
| `src/lib/ai/context-manager.ts` | legacy Native 上下文 + UI 估算 | 主链路只复用 token 估算;压缩交给 SDK |
| `src/lib/ai/agent-orchestrator.ts` | 可选轻量预路由 | 保留“是否需要正文/项目/Skill”的轻量判断,不要再决定工具循环 |
| `src/lib/ai/skills.ts` | Skill 管理核心 | 保留并作为 MCP `load_skill` 数据源 |
| `src/lib/ai/code-explorer-agent.ts` | 迁移对象 | 优先改为 MCP 工具或 SDK subagent |
| `src/lib/ai/git-analysis.ts` | 迁移对象 | 封装为 MCP 工具 `analyze_code_changes` |
| `src/lib/ai/chat-persistence.ts` | UI 历史持久化 | 保留;增加 Claude Agent session id 绑定 |
| `src/app/api/ai/chat/route.ts` | runtime 入口 | 瘦身为 preflight + runtime 调用 |

### 4.3 新增核心模块

| 模块 | 职责 |
|------|------|
| `src/lib/ai/claude-agent-runtime.ts` | Claude Agent SDK query 封装入口 |
| `src/lib/ai/claude-agent-options.ts` | 构造 SDK options、tools、allowedTools、hooks、env |
| `src/lib/ai/agent-sdk-stream-adapter.ts` | SDK message 转 UIMessage parts |
| `src/lib/ai/inkpress-mcp-server.ts` | `createSdkMcpServer` 暴露 InkPress 工具 |
| `src/lib/ai/tools/registry.ts` | InkPress 工具声明式注册表 |
| `src/lib/ai/system-prompt.ts` | 构造 Claude Agent 的 InkPress 系统提示 |
| `src/lib/ai/permission-engine.ts` | ALLOW/DENY/ASK 策略和审批记录 |
| `src/lib/ai/claude-session-store.ts` | SDK SessionStore 的 SQLite/Prisma 实现 |
| `src/lib/ai/agent-runtime-config.ts` | backend 配置、默认工具模式、隔离目录 |

---

## 5. 会话与数据模型

### 5.1 不再需要“多引擎会话”

既然 Claude Agent 是主引擎,就不需要为“双引擎选择”设计复杂的 session 分裂。建议:

- `AgentChatSession` 增加 `runtime String @default("claude-agent")`,用于标记新 runtime。
- 旧会话保留原消息,迁移时默认 `runtime = "native-legacy"` 或空值兼容。
- 新会话默认走 `claude-agent`。
- 不在 UI 暴露引擎切换。开发/调试可以通过 env 或 feature flag 临时切回 legacy。

推荐 schema 增量:

```prisma
model AgentChatSession {
  id                    String   @id @default(cuid())
  articleId             String?  @unique
  technicalDocumentId   String?  @unique
  targetKind            String   @default("article")
  runtime               String   @default("claude-agent")
  claudeAgentSessionId  String?
  claudeAgentStoreKey   String?
  summary               String   @default("") // legacy only
  summaryUpToPosition   Int      @default(-1) // legacy only
  ...
}
```

说明:

- 可以暂时保留“一目标一会话”的现有模型,降低迁移成本。
- 如果未来要做多会话列表,那是“会话管理”需求,不是“多引擎”需求。
- `summary` 与 `summaryUpToPosition` 只服务 legacy Native,新 runtime 不再依赖。

### 5.2 SDK SessionStore

Claude Agent 主链路需要保存 SDK 原生 session 状态:

- 方案 A:新建 `ClaudeAgentSessionStore` 表,按官方 SessionStore 接口存 JSON/bytes。
- 方案 B:落到 InkPress storage 文件系统,DB 只存 `claudeAgentStoreKey`。

推荐先用 Prisma/SQLite 表,便于备份和迁移:

```prisma
model ClaudeAgentSessionRow {
  id          String   @id @default(cuid())
  sessionId   String
  key         String
  valueJson   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([sessionId, key])
  @@index([sessionId])
}
```

---

## 6. Claude Agent Runtime 设计

### 6.1 Runtime 输入

```ts
type ClaudeAgentRuntimeInput = {
  sessionId: string;
  messages: UIMessage[];
  target: {
    kind: "article" | "technical-document";
    id: string;
    title: string;
    markdown: string;
    digest?: string;
    documentType?: string;
    snapshotHash?: string;
  };
  route: AgentRoute;
  loadedSkills: LoadedSkill[];
  assetCatalog: AssetCatalogItem[];
  codeSource?: CodeSourceReference;
  project?: AgentProjectConfig;
  config: AgentConfig;
  provider: AgentSdkBackendConfig;
  includeArticleBody: boolean;
  abortSignal?: AbortSignal;
};
```

`route` 仍可保留,但定位要降级:

- 不再作为“自研 Agent 编排器”。
- 只用于决定是否注入正文、是否解析代码源、是否预加载 Skill、是否显示意图步骤。
- 工具选择与执行顺序交给 Claude Agent。

### 6.2 SDK query 封装骨架

```ts
import {
  query,
  type SDKMessage,
  type ClaudeAgentOptions,
} from "@anthropic-ai/claude-agent-sdk";

export async function runClaudeAgentRuntime(
  input: ClaudeAgentRuntimeInput,
  writer: UIStreamWriter
) {
  const options: ClaudeAgentOptions = {
    cwd: resolveRuntimeCwd(input),
    env: buildClaudeAgentEnv(input.provider),
    systemPrompt: buildInkPressSystemPrompt(input),
    mcpServers: {
      inkpress: createInkPressMcpServer(input),
    },
    tools: resolveBuiltinTools(input),
    allowedTools: resolveAllowedTools(input),
    disallowedTools: resolveDisallowedTools(input),
    canUseTool: (toolName, toolInput, ctx) =>
      canUseInkPressTool({ input, writer, toolName, toolInput, ctx }),
    hooks: buildInkPressHooks(input, writer),
    includePartialMessages: true,
    sessionStore: createClaudeSessionStore(input.sessionId),
  };

  for await (const message of query({
    prompt: toClaudeAgentPrompt(input.messages),
    options,
    abortSignal: input.abortSignal,
  })) {
    writeSdkMessageToUiStream(message as SDKMessage, writer, input);
  }
}
```

实际 API 名称以安装版本 TypeScript 类型为准。开发时必须先用官方 examples 校准 `query/options/sessionStore/createSdkMcpServer` 的真实签名。

### 6.3 内置工具默认策略

默认目标是“写作产品体验优先,风险可控”:

| 工具 | 默认 | 原因 |
|------|------|------|
| `AskUserQuestion` | 开启 | 用于澄清问题,映射前端问答卡片 |
| `Read` / `Grep` / `Glob` | 有授权代码源时开启 | 只读探索项目 |
| `WebFetch` / `WebSearch` | 视配置开启 | 写作调研 |
| `Edit` | 默认关闭或 ask | InkPress 写作修改应走提案工具 |
| `Bash` | 默认关闭或严格 ask | 高风险 |
| `Agent` | 后续开启 | subagents 稳定后再启用 |

InkPress 自有写回必须优先走 MCP 工具:

- `mcp__inkpress__propose_article_revision`
- `mcp__inkpress__propose_technical_document_revision`
- `mcp__inkpress__set_article_digest`

这样能保留 InkPress 的 diff 审阅、版本哈希、摘要同步和前端提案体验。

---

## 7. InkPress MCP 工具

### 7.1 工具注册表

把 `writing-agent.ts` 里的工具抽为声明式 registry:

```ts
type InkPressToolDefinition = {
  name: string;
  title: string;
  description: string | ((ctx: ToolContext) => string);
  inputSchema: z.ZodTypeAny;
  group: "skill" | "web" | "code" | "asset" | "write" | "plan";
  permission: "allow" | "ask" | "deny";
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  execute(ctx: ToolContext, args: unknown): Promise<unknown>;
};
```

首批工具:

| MCP 名称 | 来源 | 权限 |
|----------|------|------|
| `mcp__inkpress__load_skill` | `loadSkill` | allow |
| `mcp__inkpress__read_skill_resource` | `readSkillResource` | allow |
| `mcp__inkpress__article_assets` | 素材库 | allow |
| `mcp__inkpress__web_search` | Tavily | allow/ask(按配置) |
| `mcp__inkpress__web_extract` | Tavily extract | allow/ask(按配置) |
| `mcp__inkpress__explore_project` | code explorer | allow(已授权项目) |
| `mcp__inkpress__build_code_graph` | code graph | ask |
| `mcp__inkpress__analyze_code_changes` | git analysis | allow(已授权项目) |
| `mcp__inkpress__github_pull_request` | GitHub PR reader | allow |
| `mcp__inkpress__set_article_digest` | 写摘要 | ask |
| `mcp__inkpress__propose_article_revision` | 文章提案 | ask |
| `mcp__inkpress__propose_technical_document_revision` | 技术文档提案 | ask |

### 7.2 工具返回约定

Claude Agent SDK 自定义工具返回应尽量结构化:

```ts
return {
  content: [{ type: "text", text: summary }],
  structuredContent: data,
  isError: false,
};
```

约定:

- 大型证据包同时写 UI data part,给模型的 tool output 做瘦身。
- 可恢复业务错误返回 `isError: true`,让 Agent 调整方案继续。
- 真实系统异常才抛错,由 runtime 统一转 `AgentErrorBlock`。

---

## 8. Skill 接入

InkPress 继续作为 Skill 管理层。

### 8.1 主路径:`load_skill` MCP

Claude Agent 初始 system prompt 只注入 Skill 目录摘要:

```md
可用 InkPress Skill:
- wechat-writing: 公众号写作规范
- technical-documentation: 技术文档模板
- code-change-analysis: 变更分析写作

需要完整手册时调用 mcp__inkpress__load_skill。
```

好处:

- 避免初始上下文过大。
- 保留 InkPress 当前系统 Skill / 用户 Skill / DB Skill 管理能力。
- 与现有斜杠命令 `/skill` 兼容。

### 8.2 可选路径:SDK native skills

可以把部分稳定系统 Skill 同步到隔离的 `.claude/skills` 目录,让 Claude Agent 原生发现。

注意:

- 不默认读取用户真实 `~/.claude/skills`,避免把用户个人 Claude 环境混进 InkPress。
- Electron 打包时应使用 InkPress 自己的 `CLAUDE_CONFIG_DIR` / runtime cwd。
- 先验证 InkPress `SKILL.md` frontmatter 与 SDK skill 格式兼容。

---

## 9. 系统提示与上下文注入

### 9.1 system prompt 职责

`buildInkPressSystemPrompt(input)` 负责告诉 Claude Agent:

- 你是 InkPress 的写作 Agent。
- 当前目标是公众号文章或技术文档。
- 需要修改正文时必须调用 InkPress 提案工具,不要直接在聊天里输出完整正文替代落盘。
- 当前正文、摘要、素材、代码源、Skill 目录在哪里。
- 联网和代码证据要区分事实、来源和推断。
- 写作输出要适合 InkPress 的编辑器与审阅流程。

### 9.2 正文注入策略

沿用现有 `shouldIncludeArticleBody` 思路,但只做上下文注入决策:

- 用户明确指代“当前文章/本文/这篇”时注入全文。
- 调研、代码分析、泛问答可只注入标题、摘要、大纲。
- 正文过长时注入概要,并通过 `data-context-usage` 告知用户。
- 压缩和长期记忆交给 Claude Agent SDK autocompact。

---

## 10. 流式输出与前端渲染

### 10.1 SDK message 到 UIMessage

`agent-sdk-stream-adapter.ts` 映射:

| SDK message/event | UI part |
|-------------------|---------|
| text delta | `text-start` / `text-delta` / `text-end` |
| tool_use start/delta/stop | `dynamic-tool` |
| tool_result | `dynamic-tool.output` 或证据 `data-*` |
| thinking delta | `reasoning` |
| compact boundary | `data-context-usage { compressed:true }` |
| result usage/cost | `data-context-usage` + message metadata usage |
| AskUserQuestion | `data-clarify` |
| permission ask | `data-tool-approval` |

### 10.2 前端重点

InkPress 的体验优势应集中在这些地方:

- 工具调用分组、中文 label、展开/折叠。
- 代码证据、commit 证据、项目快照卡片。
- 提案创建后的 diff 审阅与一键应用。
- `AskUserQuestion` 选项卡片,支持“其他”输入。
- `Bash/Edit/propose_*` 等 ask 权限卡片。
- 上下文压缩、长正文降级、错误恢复的可理解提示。

---

## 11. 权限与审批

### 11.1 统一策略

```ts
const POLICY: Rule[] = [
  { tool: "Read", decision: "allow" },
  { tool: "Grep", decision: "allow" },
  { tool: "Glob", decision: "allow" },
  { tool: "WebFetch", decision: "allow" },
  { tool: "WebSearch", decision: "allow" },
  { tool: "AskUserQuestion", decision: "allow" },
  { tool: "Edit", decision: "ask" },
  { tool: "Bash", decision: "ask" },
  { tool: "mcp__inkpress__load_skill", decision: "allow" },
  { tool: "mcp__inkpress__article_assets", decision: "allow" },
  { tool: "mcp__inkpress__explore_project", decision: "allow" },
  { tool: "mcp__inkpress__propose_article_revision", decision: "ask" },
  { tool: "mcp__inkpress__propose_technical_document_revision", decision: "ask" },
  { tool: "mcp__inkpress__set_article_digest", decision: "ask" },
];
```

### 11.2 审批持久化

新增 `ToolActionGrant`:

```prisma
model ToolActionGrant {
  id                String   @id @default(cuid())
  sessionId         String
  runtime           String   @default("claude-agent")
  toolName          String
  inputHash         String
  status            String   @default("pending") // pending | approved | rejected | expired
  approvalTokenHash String?
  decisionJson      String   @default("{}")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([sessionId, status])
  @@index([toolName])
}
```

`canUseTool` 命中 ask 时:

1. 创建 `ToolActionGrant(pending)`。
2. 写 `data-tool-approval`。
3. 前端展示审批卡片。
4. 用户同意/拒绝后 resume Claude Agent session。

---

## 12. Provider / Backend

Claude Agent SDK 不等价于普通 Anthropic Messages API client。配置层要单独建 backend。

```ts
type AgentSdkBackend =
  | { type: "anthropic_official"; apiKey: string }
  | { type: "bedrock"; region: string; profile?: string }
  | { type: "bedrock_gateway"; baseUrl: string; apiKey: string; region?: string }
  | { type: "vertex"; projectId: string; location: string }
  | { type: "vertex_gateway"; baseUrl: string; apiKey: string; projectId?: string }
  | { type: "foundry"; endpoint: string; apiKey: string };
```

规则:

- 官方 Anthropic API key 是 P0 首选。
- Bedrock / Vertex / Foundry 按 SDK 官方 provider path 注入 env。
- GLM/智谱/Minimax 等 Anthropic Messages 兼容端点不作为 Claude Agent SDK 直连支持项。
- 若必须支持第三方模型,优先通过 LiteLLM/one-api 转 Bedrock/Vertex gateway。
- OAuth/claude.ai 登录不用于产品化。

---

## 13. Legacy Native 处理

### 13.1 保留但不扩建

现有 `createWritingAgent` 可短期保留:

- 作为 feature flag fallback。
- 作为迁移期间对比行为。
- 作为 Claude Agent backend 不可用时的临时降级。

但不再新增:

- Native 专属工具循环能力。
- Native 专属上下文压缩升级。
- Native 专属 subagent 能力。
- 面向用户的引擎切换 UI。

### 13.2 迁移完成后的目标

当 Claude Agent Runtime 覆盖写作、润色、调研、项目探索、代码变更分析、提案创建后:

- `writing-agent.ts` 可删除或只保留测试夹具。
- `prepareAgentContext` 的摘要能力只保留给历史 compact 或完全移除。
- `agent-orchestrator` 降级为轻量 preflight。

---

## 14. 分支落地计划

建议新开分支:

```bash
git checkout -b codex/claude-agent-runtime
```

### P0:最小 Claude Agent Runtime

目标:

- 安装 `@anthropic-ai/claude-agent-sdk`。
- 用官方 Anthropic API key 跑通单轮文本流。
- `agent-sdk-stream-adapter` 能把文本写回现有对话框。
- 保留现有 Native 代码不动,通过 feature flag 走新 runtime。

验收:

- 在文章对话框发送普通问题,能看到 Claude Agent 流式回复。
- 错误能进入现有 `AgentErrorBlock`。
- 不影响现有会话持久化。

### P1:InkPress MCP 工具

目标:

- 抽 `tools/registry.ts`。
- 实现 `createInkPressMcpServer`。
- 接入 `load_skill`、`article_assets`、`propose_article_revision` 三个核心工具。

验收:

- Claude Agent 能按需加载 Skill。
- 创作/修改文章时通过 `propose_article_revision` 产生 InkPress 提案。
- 素材能被读取并用于正文插图。

### P2:前端工具渲染与提案体验

目标:

- 完成 SDK tool_use -> `dynamic-tool`。
- 补齐 `mcp__inkpress__*` 与内置工具中文 label。
- 提案、证据、上下文 usage 继续使用现有卡片。

验收:

- 工具调用过程可视。
- 提案 diff 和应用流程不回退。
- 长正文降级提示可见。

### P3:权限与 AskUserQuestion

目标:

- 实现 `permission-engine` + `ToolActionGrant`。
- 接入 SDK `canUseTool` / hooks。
- 把 `AskUserQuestion` 渲染为 `data-clarify`。

验收:

- 写回、Bash、Edit 走审批。
- 拒绝后工具不执行。
- Claude Agent 主动澄清时前端能交互并 resume。

### P4:项目/代码能力迁移

目标:

- `explore_project`、`analyze_code_changes`、`github_pull_request` MCP 化。
- 有授权代码源时开放 `Read/Grep/Glob`。
- 评估是否把 `code-explorer-agent` 改成 SDK subagent。

验收:

- 技术文档生成和变更分析可用。
- 证据块仍有文件/commit/项目快照。
- 未授权本地项目不可读。

### P5:SessionStore 与打包

目标:

- 实现 Prisma/SQLite SessionStore。
- 刷新后 resume Claude Agent session。
- Electron 打包验证 SDK binary 和 env 注入。

验收:

- 多轮长对话不丢上下文。
- autocompact 可观测。
- packaged app 可运行。

---

## 15. 验收标准

### 功能验收

- 普通问答、文章创作、润色、摘要、素材插图、技术文档、代码变更分析均走 Claude Agent Runtime。
- 修改正文必须产生 InkPress proposal,不能只把完整正文输出在聊天文本里。
- Skill 可按需加载,斜杠命令仍可用。
- 工具调用、审批、澄清、证据、提案均能在前端清晰呈现。

### 工程验收

- `writing-agent.ts` 不再是主链路。
- Claude Agent SDK 相关逻辑集中在 runtime 封装层,不散落在 route。
- InkPress 工具只有 registry 一份定义。
- 权限策略服务端权威,前端只负责展示和提交决定。
- 官方 API key 跑通;第三方兼容端点直连不作为支持项。

### 体验验收

- 用户无需理解“引擎选择”。
- 对话框呈现的是 InkPress 风格的写作过程,而不是裸 Claude Agent 日志。
- 错误、长上下文压缩、权限等待都有明确可读的 UI。

---

## 16. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| SDK API 变化 | 编译/运行失败 | 锁版本;以官方 examples 和 TS 类型为准 |
| 第三方 endpoint 不兼容 | 无法复用现有 GLM 等配置 | 独立 Agent SDK backend;官方/云厂商优先 |
| SDK 子进程资源占用 | Electron 内存/CPU 压力 | 限并发、超时、取消、资源监控 |
| 工具权限复杂 | 高风险操作误执行 | 默认最小权限;写操作 ask;服务端 checkpoint |
| 过度依赖黑盒 compact | 可观测性下降 | 映射 compact boundary;保留 usage 和事件日志 |
| 迁移破坏现有写作链路 | 回归风险 | feature flag 分支落地;P0-P5 分阶段替换 |

---

## 17. 待决问题

1. Claude Agent Runtime 的默认 backend 是只支持官方 Anthropic API key,还是 P0 同时支持 Bedrock/Vertex gateway?
2. 是否在设置页暴露“Claude Agent backend”配置,还是先走环境变量?
3. `Edit/Bash` 是否永远默认关闭,只在“开发者/项目分析模式”中经审批开放?
4. InkPress 系统 Skill 是否同步到隔离 `.claude/skills`,还是长期只走 `load_skill` MCP?
5. 多会话列表是否顺手做,还是保持现有“一目标一会话”以降低首期迁移成本?
6. `code-explorer-agent` 是先 MCP 化,还是直接改成 SDK subagent?

---

## 附录 A:官方文档索引

- Overview: https://code.claude.com/docs/zh-CN/agent-sdk/overview
- Streaming output: https://code.claude.com/docs/en/agent-sdk/streaming-output
- Handle approvals and user input: https://code.claude.com/docs/en/agent-sdk/user-input
- Give Claude custom tools: https://code.claude.com/docs/en/agent-sdk/custom-tools
- Configure permissions: https://code.claude.com/docs/en/agent-sdk/permissions
- Modifying system prompts: https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts
- Persist sessions to external storage: https://code.claude.com/docs/en/agent-sdk/session-storage
- Agent Skills in the SDK: https://code.claude.com/docs/en/agent-sdk/agent-skills
- Subagents in the SDK: https://code.claude.com/docs/en/agent-sdk/subagents
- Hooks: https://code.claude.com/docs/en/agent-sdk/hooks
- Hosting: https://code.claude.com/docs/en/agent-sdk/hosting
- Session store examples: https://github.com/anthropics/claude-agent-sdk-typescript/tree/main/examples/session-stores

## 附录 B:happyclaw 借鉴

[riba2534/happyclaw](https://github.com/riba2534/happyclaw) 是基于 Claude Agent SDK 的自托管多用户 AI Agent 系统。对 InkPress 的关键启发:

| 维度 | 借鉴 |
|------|------|
| 核心原则 | 不重造 Agent,直接复用 Claude Agent/Claude Code runtime 能力 |
| 流式事件 | 建立统一事件类型,再映射到产品 UI |
| 自定义工具 | 通过 MCP 暴露产品能力 |
| Skills | 项目级和用户级 Skill 目录可自动发现,但产品化要隔离配置目录 |
| 上下文 | 依赖 SDK autocompact,通过 hooks 做归档和可观测 |
| 多 provider | backend 抽象比单一 baseURL 更重要 |

关键教训:happyclaw issue #497 显示,GLM/智谱/Minimax 等 Anthropic Messages 兼容端点当前不适合直接接 Claude Agent SDK。InkPress 不应把“兼容 endpoint 直连”作为落地前提,而应走官方/云厂商 provider path 或 Bedrock/Vertex gateway。
