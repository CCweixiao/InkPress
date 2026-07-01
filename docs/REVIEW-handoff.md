# Code Review Handoff — Claude Agent Runtime 迁移（P0–P5）

> 分支：`codex/claude-agent-runtime`（base：`feat/space-theme-search-batch` @ f9a2fc89）
> 本文件给 review 方的概览；细节看 diff + `docs/agent-engines.md`（设计文档）+ `docs/agent-runtime-pdc.md`（后续增强 PDC）+ `docs/agent-code-reading-guide.md`（当前实现阅读指引）。

## 这条分支做了什么

把 InkPress 的 AI 对话子系统从自研 `ToolLoopAgent`（`writing-agent.ts`）迁移到 **Claude Agent SDK**（`@anthropic-ai/claude-agent-sdk` 0.3.195）为唯一主引擎，按 P0–P5 分阶段落地。原生 `writing-agent` 与 `code-explorer-agent` 已清理；聊天主链路不再存在 native fallback，也不再通过旧 LLM router 先做意图识别/Skill 选择。后端用 GLM 经 BigModel `/anthropic` 端点（实测可用，含工具调用/thinking）。

后端凭据：SystemConfig key `inkpress.claude-agent` = `{baseUrl, apiKey, model}`（设置页「写作 Agent → Claude Agent 后端」可编辑）。旧 AI 模型供应商配置不再参与主对话 agent 构建；仅保留给非主链路接口（如摘要生成、Skill 生成、手动 `/compact`）使用。主对话中的意图识别、计划、Skill 加载和工具选择都交给 Claude Agent SDK + InkPress MCP 工具完成，外层只保留本地能力问答/空正文提示/代码源授权预检等确定性短路。

## 改动概要（按关注点分组）

### 1. Claude Agent Runtime 核心（P0）
- **新建** `src/lib/ai/claude-agent-config.ts` — `getClaudeAgentConfig()`。
- **新建** `src/lib/ai/claude-agent-options.ts` — `buildClaudeAgentOptions(input)`：env（整体替换 process.env + ANTHROPIC_BASE_URL/AUTH_TOKEN + CLAUDE_CONFIG_DIR）、独立 cwd、systemPrompt、`mcpServers`、`allowedTools`/`canUseTool`/`sessionStore`/`resume`、`tools:[]`（禁内置）、`settingSources:[]`。
- **新建** `src/lib/ai/claude-agent-runtime.ts` — `runClaudeAgentRuntime`：query 流 + 限流重试外壳 `retryOnRateLimit`（导出可测）。
- **新建** `src/lib/ai/agent-sdk-stream-adapter.ts` — SDKMessage → UIMessage parts（text/reasoning 带 id；`system.init/status/api_retry/compact_boundary/permission_denied/mirror_error`、`rate_limit_event`、`tool_progress`、`tool_use_summary` 映射到现有前端 step/retry 渲染）。
- **新建** `src/lib/ai/system-prompt.ts` — `buildInkPressSystemPrompt`（注入正文/Skill 目录/codeSource 时代码工具节）。
- **改** `src/app/api/ai/chat/route.ts` — 所有正常对话直接调 runClaudeAgentRuntime；保留本地能力问答/空正文/代码源授权短路；透传 codeSource/claudeAgentSessionId/斜杠命令 Skill hint。旧 `agent-orchestrator` LLM 意图路由、`prepareAgentContext` 主链路压缩、`shouldIncludeArticleBody` 已移除。

### 2. InkPress MCP 工具（P1 + P4）
- **新建** `src/lib/ai/tools/registry.ts` — 声明式注册表（单一事实源）：12 个工具（load_skill/read_skill_resource/article_assets/set_article_digest/propose_article_revision/propose_technical_document_revision + P4：project_overview/project_search/project_read/project_glob/git_log/git_diff_summary/github_pull_request）。每个带 `permission: allow|ask|deny`。
- **新建** `src/lib/ai/inkpress-mcp-server.ts` — `createInkPressMcpServer(ctx)`：遍历 registry 用 SDK `tool()` 注册为 `mcp__inkpress__*`，handler 经 `ctx.emit` 直发 `tool-input-available/output-available` chunk + 证据 `data-*` part。

### 3. 权限审批闸门（P3）
- **新建** `src/lib/ai/permission-engine.ts` — ALLOW/DENY/ASK（数据来自 registry 的 `permission`），驱动 `claudeAllowedTools()`/`canUseTool`/`disallowedTools`。仅 `set_article_digest`=ask。
- **新建** `src/lib/ai/pending-approvals.ts` — 进程内 blocking-Promise 桥（registerPendingApproval/resolveApproval/abortApproval）。
- `claude-agent-options.ts` 的 `buildCanUseTool` — ask → 建 `ToolActionGrant`(pending) + emit `data-tool-approval` + await pending。
- **新建** `src/app/api/ai/agent-approvals/[id]/route.ts` + `.../status/route.ts` — 决议端点（mirror code-source approve）。
- **新建** `src/components/ai/ToolApprovalCard.tsx` + WritingAssistant 的 `data-tool-approval` renderer；composer 锁拆 `codeSourceApprovalBlocked || toolApprovalBlocked`。

### 4. 限流重试
- `claude-agent-runtime.ts` `retryOnRateLimit` — 限流（isRateLimitError）→ 可中止 sleep → 整轮重试，默认 10×10min（env `INKPRESS_RATE_LIMIT_MAX_RETRIES`/`INKPRESS_RATE_LIMIT_RETRY_WAIT_MS`）。
- `error-classify.ts` — 导出 `isRateLimitError`；加「Bad credentials」→「GitHub Token 无效」规则。
- **新建** `src/components/ai/RetryIndicator.tsx` + WritingAssistant 的 `data-agent-retry` renderer（只保留最新一条）。

### 5. GitHub token 策略
- `src/lib/ai/code-source.ts` `githubRequest` — token-first + **401 匿名回退**（公开仓库不依赖 token 有效性）；`ensureGithubCodeSource` — 删「首版仅支持公开仓库」，按 `metadata.private` 选 clone URL（公开匿名 / 私有 `x-access-token:@` 内嵌 + clone 后 `remote set-url` 抹 token）。

### 6. SessionStore resume + autocompact（P5）
- **新建** `src/lib/ai/claude-session-store.ts` — `createPrismaSessionStore()`（append uuid 幂等 / load 按 createdAt 序 / listSubkeys）。
- `claude-agent-options.ts` — `persistSession:true` + `sessionStore` + `resume: claudeAgentSessionId` + `env.CLAUDE_CONFIG_DIR`。SDK 本地配置/transcript 固定到 `~/.inkpress/cache/claude-agent/config`，SDK cwd 固定到 `~/.inkpress/cache/claude-agent/workspace`，与用户本机 `~/.claude` 和当前项目工作区隔离。
- adapter `system.compact_boundary` → `data-agent-step`（上下文已自动压缩）。

### 7. 配置/前端/基建
- `src/components/settings/SystemConfigManager.tsx` + `src/app/api/system-config/route.ts` — `inkpress.claude-agent` 配置编辑/校验/masking。
- `next.config.ts` — `@anthropic-ai/claude-agent-sdk` 加 `serverExternalPackages`。
- `tsconfig.json` — `exclude` 加 `"storage"`（github clone 缓存的 .ts 会污染 tsc/build）。
- `package.json`/`pnpm-lock.yaml` — 加 `@anthropic-ai/claude-agent-sdk`。已清理不再需要的直接依赖 `@ai-sdk/anthropic`、`@ai-sdk/openai`、`@modelcontextprotocol/sdk`；保留 `ai`/`@ai-sdk/react` 作为现有聊天 UI 传输层，保留 `@ai-sdk/openai-compatible` 供摘要、Skill 生成、手动 `/compact` 等非主 agent 接口使用。

### 8. Schema / 迁移
- `prisma/schema.prisma` — `AgentChatSession.{runtime,claudeAgentSessionId,claudeAgentStoreKey}` + `toolActionGrants` 关系；新表 `ToolActionGrant`、`ClaudeAgentSessionEntry`。
- 迁移：`20260629000000_agent_runtime`、`20260629124007_tool_action_grant`（已修为最小）、`20260630065937_claude_session_store`。
- **迁移历史 drift 修复**：`tool_action_grant` 曾打包后续迁移的改动（Asset 重定义 + CodeGraphCache 索引 DROP/CREATE）→ 重写为最小；删 `unified_storage`/`code_graph_local_paths` 里 2 个 stale 复合索引 CREATE。详见 memory。

## 探测/测试脚本（`scripts/probe-*.ts/.mjs`，tsx 跑，非测试框架）
probe-mcp / probe-can-use-tool / probe-approval-bridge / probe-approval-endpoint / probe-code-tools / probe-code-guard / probe-github-token / probe-rate-limit / probe-session-store / probe-session-resume / probe-claude-agent-sdk.mjs。覆盖：canUseTool 触发、审批桥 approve/reject、代码工具+证据 chip、未授权守门、github token 5 场景、限流重试 4 场景、SessionStore 适配器 6 场景。

## ✅ 已验证 / ⚠️ 未落地

| 项 | 状态 |
|---|---|
| `pnpm typecheck` | ✅ 通过（本机 Node v24 与项目 engines `>=22 <23` 有 pnpm warning） |
| `pnpm test` | ✅ 15 files / 135 tests |
| `pnpm build` | ⚠️ 本轮未完成；此前尝试耗时较久被中断，需在 CI/目标 Node 22 环境补跑 |
| canUseTool 触发 + blocking-Promise 桥（approve/reject） | ✅ probe |
| 权限端点（token 校验/dup/wrong/status） | ✅ 4/4 |
| 代码工具（project_overview/read/git_log + 证据 chip） | ✅ probe（真 GLM） |
| 未授权守门（7 工具） | ✅ 7/7 |
| GitHub token 策略（5 场景，mock fetch） | ✅ 5/5 |
| 限流重试（重试后成功/用尽/sleep 中止/非限流立即抛） | ✅ 4/4 |
| SessionStore 适配器（append/幂等/load/listSubkeys） | ✅ 6/6 |
| 迁移历史干净（`migrate dev` 生成 claude_session_store） | ✅ |
| **E2E「Claude 跨轮记忆」** | ⚠️ probe 被 GLM 529 过载挡住；adapter+接线已验，浏览器待测 |
| **浏览器实测**（ToolApprovalCard/证据 chip/多轮记忆/刷新 resume/autocompact chip） | ⚠️ 未做（headless 测不了） |
| **Electron 打包验证（P5c）** | ❌ 未做（用户选择 defer） |
| **AskUserQuestion 澄清卡** | ❌ 未做（SDK dialogKind/payload 不可定 + GLM 未验证，已 defer） |

## 🔍 Review 建议重点关注

1. **`claude-agent-options.ts` canUseTool 的 blocking-Promise 桥** — `PermissionResult` allow 分支必须带 `updatedInput`（SDK 运行时 Zod 校验，TS 标可选但缺省会 `is_error`）；abortSignal 解注册；grant 创建/状态写入的时序。
2. **`code-source.ts` token 策略** — 401 匿名回退逻辑；私有仓库 token 内嵌 URL 后 `remote set-url` 抹 token（防写 `.git/config`）；401+404 的错误文案区分。
3. **`claude-session-store.ts`** — uuid 幂等 upsert（SQLite NULL 在 unique 不去重）；load 按 createdAt 序；`$transaction` 批量。
4. **`claude-agent-runtime.ts` retryOnRateLimit × resume** — 失败轮部分 entry 写入 + 重试 resume 的边界（SDK uuid 幂等兜底，但值得看）。
5. **`registry.ts` 守门** — 所有代码工具 `if(!ctx.codeSource)throw`（未授权不可读）；路径越界靠 `resolveProjectFile`/`isBlockedRelativePath`。
6. **迁移历史修复** — `tool_action_grant` 重写是否丢了对 Asset 的必要改动（结论：没有，wx*/storageObjectId 由后续迁移负责）；checksum 更新正确性。
7. **`route.ts` Claude 分支接缝** — 旧 LLM router 已删；仅保留确定性 codeSource 授权预检和本地短路。`awaitingApproval` 早返回在 Claude 分支前；codeSource 此时必然 approved；斜杠 Skill 只是 system prompt hint，最终选择由 Claude Agent 执行。
8. **SDK `@alpha` 风险** — `sessionStore` 标 alpha，API 可能变（已锁版本 + 隔离单文件）。

## 已知局限

- 单轮→多轮：P5 已支持 resume，但「Claude 记得」E2E 未实测（GLM 过载）。
- `sessionStore` `@alpha`；`AskUserQuestion` 未做。
- 限流外层重试是**整轮重跑**（SDK 不支持 mid-turn resume）。
- 进程内 pending-approvals map：多实例/进程重启丢失（靠 `/status` TTL 兜底；真正跨进程 resume 走 SessionStore）。
- 目前未接外部 Web 检索 MCP 工具，且 `tools: []` 禁用了 SDK 内置工具；如后续要求 agent 自主检索外部资料，需要新增受控 `web_search`/`web_fetch` MCP 工具或显式开放 SDK 对应工具并纳入权限审批。
