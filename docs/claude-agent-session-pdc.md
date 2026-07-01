# Claude Agent SDK Session 管理与持久化 PDC

> PDC = Product Design Contract。本文面向后续 AI/人类开发者，约定 InkPress 接入 Claude Agent SDK 后的多轮会话、对话中断恢复、SessionStore/SQLite 持久化与 `/clear` 生命周期。

## 1. 背景与问题

用户真实场景：

1. 第一轮：`调研 Claude Agent SDK 介绍其整体实现架构`
2. Agent 正在调研，中途被打断、刷新、停止或网络断开。
3. 第二轮：`继续`
4. Agent 回答：需要确认调研方向，当前会话缺少上下文，文章编辑器为空。

这个现象不是模型“不会继续”，而是 InkPress 没有把上一轮 Claude Agent SDK 原生 session 可靠绑定到下一轮 `resume`。

## 2. 官方语义摘要

### 2.1 Session 是 Agent 的完整对话历史

Claude Agent SDK 的 session 包含用户提示、工具调用、工具结果和响应。恢复 session 后，Agent 会拥有之前已读文件、已做分析和已作决定的完整上下文。它保持的是对话历史，不是文件系统快照。

### 2.2 TypeScript 多轮必须使用 `resume` 或 `continue`

TypeScript SDK 没有 Python `ClaudeSDKClient` 那样的长生命周期 client。多轮有两种方式：

- `continue: true`：在当前 `cwd` 找最近 session，适合单进程、单对话。
- `resume: sessionId`：恢复指定 session，适合 InkPress 这种多文章、多文档、多会话场景。

InkPress 必须优先使用 `resume: AgentChatSession.claudeAgentSessionId`，不能依赖 `continue: true`，因为不同文章/文档之间可能交错运行。

### 2.3 `session_id` 要尽早捕获

SDK result 消息上有 `session_id`，无论成功还是错误 result 都有。TypeScript 的 `system/init` 消息也会更早暴露 `session_id`。因此中断恢复不能只等成功 result；一旦收到 `system/init.session_id`，InkPress 就应把它保存为当前目标的 Claude resume 入口。

### 2.4 SessionStore 是镜像，不是替代品

`sessionStore` 的职责是镜像 SDK 本地 JSONL transcript。SDK 仍先写本地磁盘，然后把批次转发给 `append()`。`sessionStore` 不能与 `persistSession:false` 同用。写入失败不会中断 Agent，而是发 `mirror_error`，所以 InkPress 要监控并在 UI/日志中暴露。

### 2.5 Adapter 必须幂等、保序、支持子路径

`SessionStore.append()` 批次可能因 SDK 重试被重复投递，必须按 entry `uuid` 去重。`load()` 要完整返回此前 append 的 entries。恢复子代理 transcript 需要实现 `listSubkeys()`，否则只能恢复主 transcript。

## 3. 当前实现诊断

### 3.1 已有基础

- `buildClaudeAgentOptions()` 已设置：
  - `persistSession: true`
  - `sessionStore: createPrismaSessionStore()`
  - `resume: input.claudeAgentSessionId`
  - 固定 `cwd` 到 InkPress runtime workspace
  - 固定 `CLAUDE_CONFIG_DIR` 到 InkPress runtime config
- `ClaudeAgentSessionEntry` 已作为 SQLite mirror 表。
- `createPrismaSessionStore()` 已实现：
  - `append()`
  - `load()`
  - `listSubkeys()`
  - entry uuid 幂等 upsert。

### 3.2 主要缺口

| 缺口 | 当前表现 | 风险 |
|---|---|---|
| 只在成功 outcome 后写 `AgentChatSession.claudeAgentSessionId` | 中断、abort、throw 没有保存 SDK session id | 下一轮没有 `resume`，`继续` 开新会话 |
| Adapter 只从 `result.session_id` 赋值 | `system/init.session_id` 更早到达但未保存 | 用户在 result 前中断时，session id 丢失 |
| catch 分支只写 usage ledger，不更新 `claudeAgentSessionId` | partial usage 可保存，但 conversation resume 入口丢失 | “成本统计正确，但上下文失忆” |
| `/clear` 删除 `ClaudeAgentSessionEntry` 且清空 `claudeAgentSessionId` | 清空聊天后无法恢复旧 Claude session | 符合“清空当前对话”的语义，但必须与“继续中断任务”区分 |
| `ClaudeAgentSessionEntry` 只有 `createdAt`，upsert 更新时不更新顺序字段 | 重放/更新时可能无法表达 append 顺序 | 极端并发或重放下 load 顺序不够强 |
| `claudeAgentStoreKey` 未使用 | 无法快速定位 projectKey / storage scope | 排障和跨主机恢复困难 |
| 没有 session 健康状态 | UI 不知道当前能否 resume | 用户输入“继续”时缺少恢复提示 |
| 没有 conformance 测试 | SessionStore 只靠自测 | SDK 升级后契约漂移风险 |

## 4. 产品原则

1. 一篇文章/一个技术文档默认绑定一个 InkPress `AgentChatSession`。
2. 一个 InkPress `AgentChatSession` 默认绑定一个 Claude SDK session。
3. 多轮对话必须恢复同一个 Claude SDK session，除非用户显式 `/clear` 或“新开 Claude 会话”。
4. 中断不是清空。中断后下一轮输入“继续”应默认 resume 上一次 Claude SDK session。
5. `/clear` 是“清空当前聊天上下文并开始新 Claude session”，不是删除历史用量。
6. Token usage ledger 独立于 Claude session transcript。清聊天、清 SDK session、删消息都不得删除 `AgentUsageTurn`。
7. SessionStore 只存 SDK transcript 原始条目，不混入 UIMessage、usage ledger 或业务提案。

## 5. 目标行为

### 5.1 正常多轮

第一轮成功完成后：

- SDK result 返回 `session_id`。
- InkPress 保存到 `AgentChatSession.claudeAgentSessionId`。
- 第二轮调用 `query()` 时传 `resume: claudeAgentSessionId`。
- 用户说“继续 / 基于刚才 / 下一步”时，Agent 能利用上一轮工具调用、调研结果、决策。

### 5.2 中断后继续

第一轮被打断后，只要 SDK 已发出 `system/init.session_id` 或已有 SessionStore entry：

- InkPress 仍保存 `claudeAgentSessionId`。
- 中断轮次状态记录为 `interrupted/partial`。
- 第二轮默认 `resume` 同一个 Claude SDK session。
- 如果用户输入“继续”，无需重新解释调研方向。

### 5.3 错误后继续

如果 SDK 返回错误 result：

- 错误 result 的 `session_id` 仍保存。
- 下一轮可以 `resume`，除非错误属于不可恢复配置错误，例如 API Key 无效。
- 对 `error_max_turns`、`error_max_budget_usd`，应提示“可继续本任务”。

### 5.4 `/clear`

`/clear` 后：

- 清空 UI 消息、业务提案、pending approvals、当前 composer token meter。
- 清空 `AgentChatSession.claudeAgentSessionId`，新一轮开启新 Claude SDK session。
- 可以删除当前 `sdkSessionId` 对应的 `ClaudeAgentSessionEntry`，但不得删除 `AgentUsageTurn`。
- 如果用户想“清空 UI 但保留 Claude 上下文”，应另设轻量动作，不能复用 `/clear`。

## 6. 数据模型改造

### 6.1 `AgentChatSession` 增强

建议新增/明确字段：

```prisma
model AgentChatSession {
  claudeAgentSessionId     String?
  claudeAgentStoreProjectKey String?
  claudeAgentSessionStatus String @default("none")
  claudeAgentLastEventAt   DateTime?
  claudeAgentLastError     String?
  claudeAgentInterruptedAt DateTime?
  claudeAgentResumeCount   Int @default(0)
}
```

状态建议：

- `none`：尚无 SDK session。
- `running`：当前 SDK session 正在执行。
- `ready`：上轮已完成，可继续。
- `interrupted`：中断/abort，但可尝试继续。
- `error`：错误结束，但可能可继续。
- `cleared`：用户显式清空，下一轮新建 session。

### 6.2 `ClaudeAgentSessionEntry` 增强

当前表可用，但建议补字段提升顺序、排障和清理能力：

```prisma
model ClaudeAgentSessionEntry {
  id           String   @id @default(cuid())
  projectKey   String
  sdkSessionId String
  subpath      String   @default("")
  uuid         String?
  entryJson    String
  entryType    String?
  entryTimestamp DateTime?
  appendSeq    Int?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([projectKey, sdkSessionId, subpath, uuid])
  @@index([projectKey, sdkSessionId, subpath, appendSeq])
  @@index([sdkSessionId])
  @@index([entryType])
}
```

说明：

- `appendSeq` 用于同一 `(projectKey, sdkSessionId, subpath)` 下稳定排序。
- `entryType` 从 `entry.type` 冗余，方便排障和清理。
- `entryTimestamp` 从 `entry.timestamp` 解析，不能解析时为空。
- 仍不建议把 `ClaudeAgentSessionEntry` 外键绑定到 `AgentChatSession`，避免 `/clear`、删除文章时误删历史排障数据。是否删除由业务动作显式决定。

### 6.3 可选新增 `ClaudeAgentSessionIndex`

如后续需要会话列表、恢复历史分支、命名/tag，可新增索引表：

```prisma
model ClaudeAgentSessionIndex {
  id             String @id @default(cuid())
  appSessionId   String
  targetKind     String
  targetId       String
  projectKey     String
  sdkSessionId   String
  title          String?
  status         String @default("ready")
  firstPrompt    String?
  lastPrompt     String?
  lastResult     String?
  startedAt      DateTime @default(now())
  lastEventAt    DateTime?
  clearedAt      DateTime?
  metadataJson   String @default("{}")

  @@unique([projectKey, sdkSessionId])
  @@index([appSessionId, lastEventAt])
  @@index([targetKind, targetId, lastEventAt])
}
```

首期可以先不加，优先把 `AgentChatSession` 字段补齐。

## 7. 后端实现契约

### 7.1 Adapter 必须捕获 `system/init.session_id`

`createSdkToUiAdapter()` 在消费 `system/init` 时：

```ts
if (m.subtype === "init" && typeof m.session_id === "string") {
  result.sessionId = m.session_id;
}
```

同时暴露 `getSessionId()` 或继续复用 `adapter.result.sessionId`。

验收：在只收到 `system/init` 后立即 abort，runtime catch 仍能拿到 session id。

### 7.2 Runtime 在任何结束路径都返回/挂载 session id

`runOnce()` 结束路径：

- success result：`outcome.sessionId = result.sessionId`
- error result：`outcome.sessionId = result.sessionId`
- throw/abort：`outcome.sessionId = adapter.result.sessionId`

`attachUsageToError()` 旁边新增 `attachSessionToError()` 或统一 error payload：

```ts
type ClaudeAgentRuntimeError = Error & {
  usageSummary?: AgentTurnUsageSummary;
  sessionId?: string;
  recoverable?: boolean;
};
```

`readSessionFromError(error)` 要导出给 route 使用。

### 7.3 Route 必须在三路保存 session id

成功：

- 保存 `outcome.sessionId` 到 `AgentChatSession.claudeAgentSessionId`。
- 状态设为 `ready`。

错误：

- 从 error 上读 `sessionId`。
- 如存在，保存为 `claudeAgentSessionId`。
- 状态设为 `error` 或 `interrupted`。

中断/abort：

- 从 error 上读 `sessionId`。
- 如存在，保存为 `claudeAgentSessionId`。
- 状态设为 `interrupted`。

注意：session id 保存失败不应阻断已返回给用户的流，但必须打 warn/error 日志。

### 7.4 SessionStore append 顺序

`append()` 应保证同批 entries 的顺序：

- 同一批次内按数组顺序分配 `appendSeq`。
- 同一 session/subpath 下 appendSeq 单调递增。
- 推荐事务内读取当前 max appendSeq，再批量写入。

`load()` 排序：

```ts
orderBy: [{ appendSeq: "asc" }, { createdAt: "asc" }]
```

不能只依赖 `createdAt`，因为 SQLite 时间精度与 upsert 更新会让顺序不够稳。

### 7.5 SessionStore key 与 projectKey

当前固定 `cwd` 是正确方向，必须继续保持稳定。新增保存：

- `AgentChatSession.claudeAgentStoreProjectKey`
- 或在 `ClaudeAgentSessionIndex` 保存 `projectKey`

如果 SDK 没有直接把 projectKey 暴露给业务层，可在 `SessionStore.append(key, entries)` 首次看到 key 时：

- upsert `ClaudeAgentSessionIndex`
- 如果能通过 `sdkSessionId` 找到当前运行的 `AgentChatSession`，回写 projectKey。

### 7.6 `resume` 选择策略

`buildClaudeAgentOptions()`：

- 有 `claudeAgentSessionId`：传 `resume`。
- 没有 `claudeAgentSessionId`：不要传 `continue:true`，开新 session。
- 不传 `sessionId`，除非明确实现“预分配 SDK session id”。

原因：InkPress 是多目标、多会话，`continue:true` 的“当前 cwd 最近 session”会串会话。

### 7.7 中断后的“继续”提示增强

系统 prompt 或 route 可在检测到 `session.claudeAgentSessionStatus === "interrupted"` 且用户短语为“继续/继续刚才/接着来”时，添加轻量上下文：

```text
本轮正在 resume 上一次被中断的 Claude Agent SDK session。请基于上一轮已完成的调研、工具调用和决策继续，不要要求用户重新说明调研方向。
```

这不是替代 `resume`，只是防止模型在短提示下过度澄清。

## 8. 前端交互

### 8.1 聊天窗口状态

在 composer 附近低存在感展示：

- `已连接 Claude 会话`
- `上次中断，可继续`
- `已清空，将开启新会话`

不要做大卡片遮挡主输出。

### 8.2 中断后继续

如果上一轮 status 为 `interrupted`：

- 输入框 placeholder 可变为：`输入“继续”可从上次中断处恢复`
- 可出现一个小按钮：`继续上次任务`
- 点击后发送用户消息 `继续`，后端仍走普通 POST，但必须带当前 `AgentChatSession`。

### 8.3 `/clear` 二次语义

`/clear` 继续保持清当前对话，但 UI 文案要明确：

- 会清空聊天消息。
- 会开启新的 Claude 会话。
- 不会清空 Token 消耗大盘。

## 9. `/clear` 与存储生命周期

| 动作 | 清理 | 保留 |
|---|---|---|
| 停止生成/断网/刷新 | 不清理 Claude session；状态设 `interrupted` | `claudeAgentSessionId`、SessionStore entries、usage ledger |
| 第二轮继续 | 使用 `resume: claudeAgentSessionId` | 原 session entries 继续累积 |
| `/clear` | UI messages、pending grants、业务提案、当前 `claudeAgentSessionId`、可选删除对应 SessionStore entries | `AgentUsageTurn` |
| 设置页清空 Token 统计 | `AgentUsageTurn` | UI messages、Claude session、SessionStore |
| 删除文章/文档 | 业务对象及其 chat session | 是否保留 SessionStore 由保留策略决定，usage ledger 保留 |

## 10. 测试计划

### 10.1 单元测试

1. Adapter 捕获 `system/init.session_id`。
2. Abort before result：runtime error 上可读到 `sessionId`。
3. Error result：error 上可读到 `sessionId` 和 usage。
4. Route catch：有 `sessionId` 时更新 `AgentChatSession.claudeAgentSessionId`。
5. `buildClaudeAgentOptions()`：有 session id 时传 `resume`，无 session id 时不传 `continue`。
6. SessionStore append 幂等：同 uuid 重放不重复。
7. SessionStore append 顺序：同批多条 load 顺序不变。
8. SessionStore listSubkeys：能返回 `subagents/agent-*`。
9. `/clear`：清 `claudeAgentSessionId` 和 messages，不删 `AgentUsageTurn`。

### 10.2 集成测试

1. 第一轮真实 query 收到 `system/init` 后模拟 abort。
2. 检查 DB：
   - `AgentChatSession.claudeAgentSessionId` 非空。
   - `ClaudeAgentSessionEntry` 有对应主 transcript。
   - status 为 `interrupted`。
3. 第二轮发送 `继续`。
4. 断言 `query()` options 含 `resume: <上一轮 sdkSessionId>`。

### 10.3 浏览器 E2E

1. 创建空文章。
2. 发起调研任务。
3. 中途停止。
4. 刷新页面。
5. 输入 `继续`。
6. 验证 Agent 不再要求用户重新说明调研方向，而是继续上一轮调研。
7. `/clear` 后再次输入 `继续`，应开启新会话并可合理澄清。

### 10.4 官方 conformance

从 Claude Agent SDK examples 复制 TypeScript SessionStore conformance 测试到本仓库，覆盖：

- append
- load
- uuid dedupe
- optional listSubkeys
- delete 如实现则测试 delete

## 11. 实施顺序

### P0：先修“中断后失忆”

1. Adapter 捕获 `system/init.session_id`。
2. Runtime 在 abort/throw/error result 上挂 `sessionId`。
3. Route catch 分支保存 `sessionId`。
4. 增加单测：abort before result 后第二轮 options 包含 `resume`。

### P1：强化 SQLite SessionStore

1. 给 `ClaudeAgentSessionEntry` 增加 `appendSeq`、`entryType`、`entryTimestamp`、`updatedAt`。
2. append 同批保序，uuid 重放不破坏顺序。
3. load 按 `appendSeq` 排序。
4. 补 conformance 测试。

### P2：会话状态与 UI 提示

1. `AgentChatSession` 增加 session status 字段。
2. 前端展示低存在感 session 状态。
3. 中断后显示“继续上次任务”入口。
4. `/clear` 文案明确“开启新 Claude 会话”。

### P3：会话索引与排障

1. 可选新增 `ClaudeAgentSessionIndex`。
2. 支持设置页/调试页查看 SDK session、entry 数、lastEventAt、mirror_error。
3. 支持手动“重新导入本地 JSONL 到 SessionStore”作为修复工具。

## 12. AI 开发提示词

```text
请严格按 /Users/jielongping/OpenProject/InkPress/docs/claude-agent-session-pdc.md 实现 Claude Agent SDK session 管理修复。

重点目标：
1. 修复中断后输入“继续”丢失上下文的问题。
2. Adapter 必须从 system/init.session_id 尽早捕获 SDK session id。
3. Runtime 在 success/error/abort/throw 三路都必须向 route 暴露 sessionId。
4. Route 在 success/error/abort 三路都要保存 AgentChatSession.claudeAgentSessionId。
5. 下一轮必须通过 options.resume 恢复同一个 Claude SDK session。
6. 不允许用 continue:true 替代 resume，因为 InkPress 存在多文章/多文档多会话。
7. SessionStore 仍是 SDK transcript 镜像，不要混入 UIMessage 或 usage ledger。
8. /clear 可以清当前 Claude resume 入口和 SessionStore，但不能删除 AgentUsageTurn。
9. 补充单测与必要集成测试，至少覆盖 abort before result 后 session id 仍保存并可 resume。

请先最小修 P0，再做 P1/P2。发现与现有代码冲突时，输出冲突点和最小调整方案后继续。
```

## 13. 验收总表

| 场景 | 验收标准 |
|---|---|
| 正常多轮 | 第二轮 `query()` 带 `resume`，Agent 能引用上一轮调研结果 |
| 中断后继续 | result 前 abort 也保存 `claudeAgentSessionId`，第二轮 `继续` 不失忆 |
| 错误后继续 | error result 保存 session id，下一轮可 resume |
| SessionStore | append/load/listSubkeys 通过 conformance；uuid 重放不重复 |
| `/clear` | 清 UI 与当前 Claude session，保留 Token usage ledger |
| 多目标隔离 | 文章 A 和文章 B 不会因 `continue:true` 串用最近 session |
| 子代理恢复 | 子代理 subpath entries 可 listSubkeys 并随 resume 物化 |
| UI | 中断后给出低存在感“可继续”提示，不遮挡主输出 |
