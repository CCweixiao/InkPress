# P3 + P4 实现 Review 要点

> 自包含文档：另一个 AI 据此审查核心实现。聚焦**最可能出问题/最不确定**的关键点（按风险排序），附关键代码片段 + 建议审查方向。代码库路径：`/Users/jielongping/OpenProject/InkPress`。

## 范围

- **P3 ArticleTypeProfile**：文章带 `profileId`，按类型注入 system-prompt 引导 + 默认 Skill。文件：`src/lib/ai/article-type-profile.ts`、`prisma/schema.prisma`(Article.profileId)、`src/app/api/articles/route.ts`、`src/app/api/ai/chat/route.ts`、`src/lib/ai/claude-agent-options.ts`、`src/lib/ai/system-prompt.ts`、`src/components/articles/NewArticleButton.tsx`
- **P4 Subtask**：SDK 原生 `Options.agents`（research/review/fact_check）。文件：`src/lib/ai/subagents.ts`、`src/lib/ai/claude-agent-options.ts`、`src/lib/ai/agent-sdk-stream-adapter.ts`、`src/lib/ai/system-prompt.ts`

SDK：`@anthropic-ai/claude-agent-sdk` 0.3.195。后端默认 GLM-4.6 @ BigModel `/anthropic`（兼容端点）。

---

## 🔴 高风险点（最该审查）

### 1. P4 子 agent 的 `tools` 引用 `mcp__inkpress__*` —— 是否能解析？（最大不确定性）

**实现**（`src/lib/ai/subagents.ts`）：
```ts
export const INKPRESS_SUBAGENTS: Record<string, AgentDefinition> = {
  research: {
    description: "...",
    prompt: RESEARCH_AGENT_PROMPT,
    tools: [
      "mcp__inkpress__web_search", "mcp__inkpress__project_overview",
      "mcp__inkpress__project_search", "mcp__inkpress__project_read",
      "mcp__inkpress__load_skill",
    ],
  },
  review: { ..., tools: ["mcp__inkpress__load_skill", "mcp__inkpress__article_assets"] },
  fact_check: { ..., tools: ["mcp__inkpress__web_search"] },
};
```
父 agent 在 `claude-agent-options.ts` 用 `mcpServers: { inkpress: mcpServer }`（in-process MCP）。

**担心**：`AgentDefinition.tools` 引用 `mcp__inkpress__*`——**子 agent 是否继承父的 `mcpServers`？** 如果 SDK 子 agent **不继承**父 mcpServers，这些工具名解析不到，子 agent 启动后**没有任何工具可用**（research 不能 web_search/project_read，等于空跑）。

**审查方向**：
- 查 SDK `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` 的 `AgentDefinition`（约 L38-92）：是否有 `mcpServers` 字段？注释是否说"子 agent 默认继承父 mcpServers"？
- 查 SDK 内部（index.mjs）子 agent 启动时如何解析 `tools` 与父 `mcpServers` 的关系。
- **若不继承**：修复 = 在每个 `AgentDefinition` 显式加 `mcpServers`（但要复用父的 `createSdkMcpServer` 实例，或重建）。这是个易漏点。

### 2. P4 stream adapter 的 `task_*` 事件字段名是否正确？

**实现**（`src/lib/ai/agent-sdk-stream-adapter.ts`，system case 新增）：
```ts
if (m.subtype === "task_started") {
  writer.write({ type: "data-agent-step", data: {
    title: `子任务启动（${String(m.subagent_type ?? "subagent")}）`,
    detail: typeof m.prompt === "string" ? m.prompt.slice(0, 160) : "",
    status: "running",
    ...(typeof m.task_id === "string" ? { subTaskId: m.task_id } : {}),
  }});
} else if (m.subtype === "task_progress") {
  // 用 m.summary / m.last_tool_name
} else if (m.subtype === "task_notification") {
  const ok = m.status === "completed";
  // 用 m.summary
}
```
`m` 是 `consume(message: SDKMessage)` 里 `message as Record<string, unknown> & { type: string }`（松结构）。访问 `m.subagent_type` / `m.task_id` / `m.summary` / `m.last_tool_name` / `m.prompt` / `m.status` 全靠字段名猜。

**担心**：SDK 的 `SDKTaskStartedMessage`/`SDKTaskProgressMessage`/`SDKTaskNotificationMessage`（sdk.d.ts 约 L4116-4197）**实际字段名**是否真的是 `subagent_type`/`task_id`/`summary`/`last_tool_name`？字段名拼错 → 永远取到 `undefined` → 前端显示"子任务启动（subagent）"无内容、无 subTaskId。

**审查方向**：
- 查 SDK `sdk.d.ts` 这三个 message 类型的精确字段名（`subagent_type` vs `subagentType`？`task_id` vs `taskId`？`last_tool_name` vs `lastToolName`？）。
- SDK message 流是 **snake_case**（参考现有 adapter 用 `m.api_retry`/`m.compact_metadata`/`m.retry_delay_ms` 都是 snake_case）—— 所以 `subagent_type`/`task_id`/`last_tool_name` 大概率对，但 `summary`/`prompt`/`status` 要确认。
- **建议**：P4 联调时在 adapter 临时 `console.log(JSON.stringify(m))` 抓一条真实 task_* 消息，核对字段名。

---

## 🟡 中风险点

### 3. P3 `Article.profileId` migration（已修复）

**实现**：`prisma/schema.prisma` Article 加 `profileId String?`，用 `DATABASE_URL=file:./dev.db prisma db push` 加列（因为 `prisma migrate dev` 检测到 dev.db 与历史 drift，reset 会丢数据）。

**修复**：已补 `prisma/migrations/20260708010000_article_profile/migration.sql`，包含 `ALTER TABLE "Article" ADD COLUMN "profileId" TEXT;`。同时补了 `WebFetchDomainAllowlist` 建表 migration，避免生产空库缺表。

**审查方向**：后续只需确认部署环境的 Prisma CLI 能正常执行历史迁移；SQL 层已用 `sqlite3` 全量顺序应用验证通过。

### 4. P3 `preferredSkillIds` 合并逻辑（forceSkillIds + defaultSkills）

**实现**（`src/app/api/ai/chat/route.ts`，原 `slice(0,4)` 改 `slice(0,8)`）：
```ts
const profile = getArticleProfile(loaded.profileId);
const preferredSkillIds = Array.from(
  new Set([...(parsed.data.forceSkillIds ?? []), ...profile.defaultSkills])
).slice(0, 8);
```

**担心**：
- forceSkillIds 在前、defaultSkills 在后——优先级对（斜杠命令优先）。
- `slice(0, 8)`：若 defaultSkills 多于 8-forceSkillIds 数，会被截断。当前每个 profile defaultSkills ≤1，所以无影响。但 magic number 8 是否合理？
- `loaded.profileId` 在 `execute` 闭包内可访问吗？`loaded` 是 POST handler 外层 `loadTarget` 返回，`execute` 是 `createUIMessageStream({execute})` 闭包——需确认 `loaded` 在 execute 作用域可见（应该是，闭包捕获）。

**审查方向**：确认 `loaded` 闭包可见 + slice 上限是否该用常量。

### 5. P4 子 agent 只用 allow 工具，回避审批（设计取舍）

**实现**：子 agent tools 只含 `permission:"allow"` 的工具（web_search/project_*/load_skill/article_assets），**不含** `web_fetch`（ask）。

**担心**：
- research 子 agent **不能用 web_fetch**（只 web_search）——搜索到 URL 后无法抓正文，调研深度受限。
- 设计理由是"避免子 agent 内走 canUseTool 审批"（子 agent 审批卡 UX 复杂）。
- 但 PDC §6 的 research 子任务本应能 web_fetch 取证。这是功能妥协。

**审查方向**：这个取舍是否可接受？或子 agent 的 web_fetch 应走"主 agent 的 autoApprove/白名单"（`buildCanUseTool` 对子 agent 也生效，可读 `webResearch.autoApprove`）。若要支持，需确认 SDK `canUseTool` 对子 agent 工具调用是否触发（`PreToolUseHookInput.agent_id` 区分主/子）。

### 6. P3 profile 只做 prompt 引导，不改工具可用性（偏离 PDC §7.3？）

**实现**：`ArticleTypeProfile` 只有 `defaultSkills`/`promptSection`/`checklist`，**没有** PDC §7.1 的 `webPolicy`/`evidencePolicy`/`assetPolicy`。profile 不真正禁用/强制工具。

**担心**：PDC §7.3 说"Web/代码/素材工具是否可用，受 profile policy 和权限规则共同决定"。我的实现里 `news_commentary` 即使声明需要 web，agent 也**可能不联网**（只引导不强制）。偏离 PDC 设计？

**审查方向**：这是有意取舍（profile 只引导，权限留 P5）还是漏做？PDC §7.3 的 policy 是否该在本期实现？

---

## 🟢 低风险点（知情即可）

### 7. system-prompt 膨胀
P3 注入 `typeSection`（promptSection + checklist 5 条）+ P4 注入 `subagentSection`（5 条）+ web section（越来越长，含 GLM 防幻觉的 WEB_FETCH_STATUS 引导）。system-prompt 比最初长了约 40%。**审查方向**：是否该按 profile/场景裁剪（如非 news_commentary 不注入 web 防幻觉段）。

### 8. `NewArticleButton` 从一键改两步（Popover）
原点击直接创建，现点击 → Popover 选类型 → 创建。**担心**：列表场景（`SpaceSection` 用 `size="sm"`）多一步点击。是否该提供"默认类型一键创建 + 下拉选其他"的 split button？

### 9. P3 `getArticleProfile` 兜底
老文章 `profileId=null` → 回落 `wechat_essay`。**审查方向**：回落默认是否合理（老技术文章也会被当公众号观点文引导）？或该按内容启发式判断？本期接受回落。

---

## 跨阶段交互点（另一个 AI 改过 web-fetch，确认不冲突）

另一个 AI 近期改了（非我）：
- `permission-engine.ts` 回退为**纯静态**（`claudeAllowedTools()` 不再接 cfg，web_fetch 永不进 allowedTools，统一走 canUseTool）—— 我的 P4 子 agent tools 用 `MCP_PREFIX + name` 拼接，依赖 `permission="allow"` 判断，与静态 permission-engine 一致 ✓。
- `inkpress-mcp-server.ts` 加 `buildInkPressToolCallResult` + `modelResultMode`（GLM tool_result 修复）—— 不影响 P3/P4。
- `web-research.ts` 加 `fetchWithSafeRedirects` —— 不影响 P3/P4。

**审查方向**：确认 P4 子 agent 的 allow-only tools 判断（`INKPRESS_TOOLS.filter(t => t.permission === "allow")`）与另一个 AI 改的静态 permission-engine 一致（应该一致，都读 registry.permission）。

---

## 建议审查顺序（给另一个 AI）

1. **先看高风险 1**（子 agent mcpServers 继承）—— 这决定 P4 能不能跑。查 SDK sdk.d.ts AgentDefinition + index.mjs 子 agent 启动逻辑。
2. **再看高风险 2**（task_* 字段名）—— 查 SDK 三个 task message 类型字段名。
3. **中风险 3**（profileId migration）—— 确认生产部署方案。
4. 其余按需。

**最有价值的验证**：在 `agent-sdk-stream-adapter.ts` 的 `task_started` 分支临时加 `console.log("[P4 task_started]", JSON.stringify(m))`，用官方 Claude 跑一次调研任务，抓真实 task_* 消息——一能确认字段名（高风险 2），二能确认子 agent 是否真的被调起 + 有没有工具（高风险 1）。
