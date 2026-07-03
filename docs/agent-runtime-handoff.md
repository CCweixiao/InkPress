# InkPress Agent Runtime — 整体 Review + 后续待办（交接文档）

> 给接手 AI：本文是 P0-P4 + 前端可见性 + web 审批改动后的**整体盘点 + 未完成项交接**。读完能理解架构、知道做什么、怎么验证、避免踩坑。代码库：`/Users/jielongping/OpenProject/InkPress`。

## 0. 一句话概况

InkPress（Next.js 16 + Electron 写作应用）以 **`@anthropic-ai/claude-agent-sdk` 为主 agent loop**，InkPress 负责工具/Skill/权限/提案/前端。后端默认 GLM-4.6 @ BigModel `/anthropic`（兼容端点），可切官方 Claude。当前 **typecheck / lint / test 全绿，237/237 tests 通过**。

## 1. 已完成阶段总览

| 阶段 | 状态 | 核心 | 关键文件 |
|---|---|---|---|
| **P0 协议冻结** | ✅ | `AgentRuntimeEvent` 判别联合 + `seq` 注入（data→`part.data`，tool→`part.toolMetadata`，**绝不动顶层字段**否则 SSE strictObject 崩） | `src/lib/ai/agent-runtime-events.ts`、`agent-event-writer.ts` |
| **P1 display registry** | ✅ | 工具 display 后端化（`category/version/display/outputSchema?`），前端 ToolCallBlock 优先 `toolMetadata.display` 回退 `TOOL_LABELS` | `src/lib/ai/tools/registry.ts`、`inkpress-mcp-server.ts`、`tool-helpers.tsx` |
| **P2 Web research** | ✅ | `web_search`(allow) + `web_fetch`(ask) MCP 工具 + Tavily + SSRF 守卫 + `data-web-source` evidence | `src/lib/ai/tools/web-research.ts`、`registry.ts` |
| **P2.5 Web 授权** | ✅ | 域名白名单表 + autoApprove 开关 + 一级配置 `inkpress.web-research`（兼容回落旧 tavilyApiKey） | `src/lib/ai/web-allowlist.ts`、`web-research-config.ts`、设置页「联网搜索」tab |
| **P3 ArticleTypeProfile** | ✅ | 6 个文章类型 profile（影响 system-prompt 引导 + 默认 skill + checklist）+ 顺手补 `documentType` 进 prompt | `src/lib/ai/article-type-profile.ts`、`system-prompt.ts` |
| **P3 前端可见性** | ✅ | `ArticleProfileBadge`（对话区顶部显示类型 + checklist）+ profileId props 链接通 | `src/components/ai/ArticleProfileBadge.tsx` |
| **P4 Subtask** | ✅ | SDK 原生 `Options.agents`（research/review/fact_check）+ `forwardSubagentText:false`（隔离）+ task_* 事件渲染 | `src/lib/ai/subagents.ts`、`agent-sdk-stream-adapter.ts` |
| **web 审批增强**（另一 AI） | ✅ | `assessWebUrlRisk` 风险评估 + 审批卡 batch（session:web_fetch 批量）+ `modelResultMode`(GLM tool_result 修复) + `fetchWithSafeRedirects` | `src/lib/ai/web-url-risk.ts`、`claude-agent-options.ts` |
| **SubTaskCard**（另一 AI） | ✅ | `SubAgentTaskBlock` + `aggregateParts` 按 `part.data.subTaskId` 聚合 task_* 成折叠卡片 | `src/components/ai/SubAgentTaskBlock.tsx` |

## 2. 核心架构（接手必读）

### 2.1 一轮对话数据流
```
POST /api/ai/chat (route.ts)
  → loadTarget（读 Article.profileId/documentType/markdown）
  → createUIMessageStream({ execute: async ({writer}) => {
      const ew = createAgentEventWriter(writer, {turnId, source})  // P0 seq 注入
      runClaudeAgentRuntime(input, ew)
        → buildClaudeAgentOptions（system-prompt + mcpServers + agents + canUseTool + allowedTools）
        → SDK query({prompt, options})
        → for await message: adapter.consume(message)  // SDK message → UIMessage parts
        → MCP 工具 handler（in-process）经 ctx.emit 直发 tool-input/output-available
    }})
```

### 2.2 关键模块
- **`src/lib/ai/tools/registry.ts`** — 声明式工具注册表（`INKPRESS_TOOLS`，单一事实源）。每个工具：`name/permission/category/version/display/toContentText?/execute`。
- **`src/lib/ai/claude-agent-options.ts`** — 组装 SDK `Options`（env/systemPrompt/agents/mcpServers/canUseTool/allowedTools/sessionStore）。**子 agent 在这里声明**（`agents: buildSubagents()`）。
- **`src/lib/ai/permission-engine.ts`** — **纯静态**（另一个 AI 改的，回退了动态 cfg）。`evaluateToolPermission(bareName)` + `claudeAllowedTools()`。web_fetch 永不进 allowedTools，统一走 canUseTool（在 buildCanUseTool 内做 autoApprove/白名单短路）。
- **`src/lib/ai/agent-sdk-stream-adapter.ts`** — SDK message → UIMessage parts。处理 text/reasoning/system(init/api_retry/compact_boundary/permission_denied/**task_started/task_progress/task_notification**)/tool_progress。
- **`src/lib/ai/system-prompt.ts`** — 按_profile/documentType/codeSource/web/subagent_ 注入段。越来越长（见风险 4.4）。

### 2.3 事件协议（P0）
- `AgentRuntimeEvent`（`agent-runtime-events.ts`）+ `seq`（data part→`part.data.seq`，tool part→`part.toolMetadata.seq`）。
- **命门**：Vercel AI SDK 客户端 `strictObject` 校验（`node_modules/ai/dist/index.mjs:5399-5463`），**顶层加未知字段会让 SSE 流崩溃**。所以 seq 进 `part.data`、display 进 `toolMetadata`。
- 子任务 `subTaskId` 放 `data-agent-step.data.subTaskId`（P4 task_* 事件带 task_id）。

### 2.4 权限链路
```
registry.permission(allow/ask/deny)
  → allow → claudeAllowedTools()（SDK 自动批准，不触发 canUseTool）
  → ask → buildCanUseTool：
       web_fetch 特殊：先 autoApprove/白名单短路（emit 提示 step + allow）
       否则 → 建 ToolActionGrant(pending) + emit data-tool-approval + await 进程内桥
              → POST /api/ai/agent-approvals/[id] 决议 → resolveApproval 唤醒
```

## 3. SDK 关键事实（0.3.195，校准自 sdk.d.ts）
- `query({prompt, options})`；`options.env` **整体替换** process.env。
- `Options.agents?: Record<string, AgentDefinition>`（子 agent，模型经内置 Agent/Task 工具调起）。
- `AgentDefinition{description, prompt, tools, model, mcpServers, maxTurns}`。
- `forwardSubagentText:false`（默认）→ 子 agent 内部工具历史不进主会话，只回 finalText。
- 子 agent transcript 自动存 `ClaudeAgentSessionEntry.subpath`（`listSubkeys` 已闭环）。
- `canUseTool` 的 allow 分支**必须带 `updatedInput`**（SDK Zod 校验，缺省被拒）。
- `tool()` MCP 工具返回 `CallToolResult{content, structuredContent?, isError}`。

## 4. 已知风险 / 技术债（接手注意）

### 4.1 ✅ prisma migration drift（已修复）
- 已补 `prisma/migrations/20260708000000_web_allowlist_risk/migration.sql`：创建 `WebFetchDomainAllowlist`。
- 已补 `prisma/migrations/20260708010000_article_profile/migration.sql`：给 `Article` 增加 `profileId`。
- 已用 `sqlite3` 顺序执行全量 migration 验证 SQL 可从空库正向应用；`prisma validate` 通过。当前 Prisma CLI `migrate deploy` 在本机仍报空 `Schema engine error`，不像新增 SQL 本身的问题，后续若要查应单独看 Prisma 7 CLI/历史迁移组合。

### 4.2 🔴 GLM 可靠性（用户当前后端）
- **web_fetch 误报失败**：GLM 拿到 tool_result 却说"failed"（另一个 AI 加了 `modelResultMode:"text-only"` + system-prompt `WEB_FETCH_STATUS: SUCCESS` 引导缓解，但根因是 GLM 工具调用弱）。
- **P4 子 agent**：Agent 工具调起依赖模型主动调用，**GLM 可能不调**。建议用官方 Claude 验证 P4。
- **建议**：所有 agent 行为类验证用官方 Claude；GLM 适合轻量问答。

### 4.3 🟡 dev server prisma client 缓存
- `prisma db push + generate` 后，**必须重启 dev server**（Node require 缓存旧 client）。否则新列（如 profileId）运行时报 `Unknown field`。
- 上次 NewArticleButton 报 `Unexpected end of JSON input` 就是这个（已加 route try/catch 兜底）。

### 4.4 🟡 system-prompt 膨胀
- P3 typeSection + P4 subagentSection + web section（含 GLM 防幻觉引导）+ checklist。比最初长 ~40%。
- 可按 profile/场景裁剪（如非 news_commentary 不注入 web 防幻觉段）。

### 4.5 ✅ WritingAssistant react-hooks/refs errors（已修复）
- `WritingAssistant.tsx` 的 render 期 ref 写入已搬到 effect，proposal 前缀缓存改为纯 `useMemo`。
- `pnpm lint` 现在 exit 0；剩余是 warn-first 的存量 warnings。

### 4.6 🟡 project-access.test flaky
- `tests/unit/project-access.test.ts` 偶发失败（`expected 1 to be 3`，文件系统搜索）。pre-existing，重跑通常过。`git stash` 隔离可证与改动无关。

## 5. 未完成项（按优先级，接手实施）

### ✅ 已完成：prisma migration 文件
已补 `Article.profileId` 与 `WebFetchDomainAllowlist` 的 migration sql，并验证全量 SQL migration 可顺序应用。

### 🔴 优先级 2：P5 Permission learning（PDC §10，用户痛点）
**目标**：审批可学习——用户批准一次后，同类操作自动放行（不重复弹卡）。通用化（不只 web_fetch）。
**现状**：另一个 AI 已做 web_fetch 的 batch（`scope: session:web_fetch`）+ riskAssessment（`web-url-risk.ts`）+ autoApprove/白名单（P2.5）。这是 P5 的雏形。
**待办**：
- `PermissionRule` 表（`{toolName, matcher, behavior: allow/deny/ask, scope: session/workspace/global}`）—— 通用化 P2.5 的白名单（不只域名）。
- 审批卡支持 `suggestedRule`（"本会话/长期信任/拒绝并记住"）—— 复用 CodeSourceGrant trusted 模式。
- `buildCanUseTool` 查规则短路（通用，不只 web_fetch）。
- 设置页规则管理 UI（查看/删除）。
**文件**：`permission-engine.ts`、`buildCanUseTool`、`agent-approvals/[id]/route.ts`、设置页。
**注意**：另一个 AI 在改 web 审批，**避免同时改 buildCanUseTool/审批卡**，先协调或聚焦规则存储 + 管理 UI。

### ✅ 已完成：ProposalCard 显示审稿 checklist
提案卡已按当前 `profileId` 展示审稿清单，用户审稿时可直接对照文章类型要求。

### ✅ 已完成：profile 在线切换
`api/articles/[id]` 已支持更新 `profileId`，编辑器内 `ArticleProfileBadge` 可直接切换文章类型，并通过自动保存持久化。

### 🟢 优先级 5：P6 Runtime adapter 抽象（PDC §13，低价值重构）
**目标**：抽 `AgentRuntime` interface（`runTurn/resume/cancel`），当前 `runClaudeAgentRuntime` 改 adapter + MockAdapter（UI/E2E 测试）。
**价值**：前端/route 不依赖具体 SDK；未来换 Python/Go runtime。**纯重构，用户无感知**，优先级最低。
**文件**：`claude-agent-runtime.ts` → adapter，route 通过 interface 调，新增 mock。

### 🟢 优先级 6：其他遗留（按需）
- **子 agent 内 web_fetch/写回工具**：当前子 agent 只用 allow 只读工具（避免审批）。若要 research 能 web_fetch，需处理子 agent 审批（`canUseTool` 的 `agent_id` 区分主/子）。
- **子 agent 独立 model**（如 research 用 haiku 省钱）：`AgentDefinition.model` 已支持，按需配。
- **SubTaskCard 增强**：`SubAgentTaskBlock` 已存在，可加运行时长/进度条等。
- **system-prompt 裁剪**（风险 4.4）。

## 6. 接手指南

### 6.1 环境
- `pnpm dev`（Next.js + Turbopack）。改 prisma 后**必须重启**。
- DB：`dev.db`（SQLite），`DATABASE_URL=file:./dev.db`（prisma config 在 `prisma.config.ts`）。
- 配置：设置页「Claude Agent 后端」（baseUrl/apiKey/model）+「联网搜索」（Tavily key + autoApprove + 白名单）。
- 验证模型行为**建议官方 Claude**（GLM 工具调用不可靠）。

### 6.2 验证命令
- `pnpm typecheck`（tsc --noEmit）
- `pnpm test`（vitest，pre-existing project-access 偶发失败可忽略）
- `pnpm lint`
- 联调：`pnpm dev` + 设置页配置 + 对话触发

### 6.3 关键文档
- `docs/agent-runtime-pdc.md` — PDC 路线图（P0-P6 设计）
- `docs/agent-engines.md` — SDK 迁移设计（P0-P5 已完成）
- `docs/agent-ui-redesign.md` — 前端重构设计
- `docs/review/p3-p4-implementation-review.md` — P3/P4 实现 review（高风险点）
- `docs/review/web-fetch-issue-review.md` — web_fetch GLM 问题 review
- `~/.claude/projects/.../memory/claude-agent-runtime-p0.md` — 各阶段详细落地记录（最全）

### 6.4 接手第一步建议
1. 读 `~/.claude/projects/.../memory/claude-agent-runtime-p0.md`（各阶段详细记录）。
2. 跑 `pnpm typecheck && pnpm test` 确认基线绿。
3. 按优先级选未完成项（建议继续评估 P5 通用 PermissionRule 或 P6 Runtime adapter）。
4. P5 前确认另一个 AI 是否还在改 web 审批（避免冲突）。

---

**核心原则**（PDC §15，必须遵守）：
1. Claude Agent SDK 是主 loop，不恢复自研 ToolLoopAgent。
2. 前端只依赖 AgentRuntimeEvent/UIMessage parts，不依赖 SDK 原始消息。
3. 工具能力通过 InkPress MCP registry 声明。
4. 新增工具必须带 permission/display/evidence/output contract。
5. 子任务内部历史不得污染主会话（`forwardSubagentText:false`）。
6. Web/代码/写入类能力必须走权限系统。
7. 所有变更补 typecheck + test + lint。
