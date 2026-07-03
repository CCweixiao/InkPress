# InkPress Agent 代码阅读指引

> 本文描述 **当前代码实现**，用于帮助后续 AI/开发者完整梳理 InkPress agent 回话能力：模型配置加载、agent runtime 创建、意图识别边界、工具注册、Skill 加载、权限审批、上下文存储、多轮对话与压缩设计。
>
> 相关设计文档：
> - `docs/agent-engines.md`：Claude Agent 封装层设计背景，部分内容是迁移期设计，阅读时以当前代码为准。
> - `docs/agent-runtime-pdc.md`：后续增强 PDC，包含可插拔 runtime、Article Profile、Subtask、Web Research 等未来路线。
> - `docs/review/REVIEW-handoff.md`：当前未提交迁移改动的 review handoff。

---

## 1. 先读哪几个入口

建议按下面顺序看代码：

```text
1. src/app/api/ai/chat/route.ts
   先看 HTTP chat 主入口，理解一轮回话如何开始、短路、授权、进入 runtime。

2. src/lib/ai/claude-agent-runtime.ts
   看 Claude Agent SDK query 如何运行、如何限流重试、如何接入 stream adapter。

3. src/lib/ai/claude-agent-options.ts
   看模型配置、system prompt、MCP server、权限、SessionStore、隔离目录如何拼成 SDK Options。

4. src/lib/ai/tools/registry.ts
   看 InkPress 暴露给 agent 的全部工具。

5. src/lib/ai/inkpress-mcp-server.ts
   看工具 registry 如何包装成 Claude Agent SDK in-process MCP server。

6. src/lib/ai/chat-persistence.ts
   看 UIMessage 历史如何合并、分页、持久化，避免前端 remount 丢历史。

7. src/lib/ai/claude-session-store.ts
   看 Claude Agent SDK 原生 transcript 如何镜像到 Prisma。

8. src/components/editor/WritingAssistant.tsx
   看前端如何发送消息、渲染 parts、审批锁定 composer、处理 direct/proposal。
```

---

## 2. 当前总体架构

当前主 agent loop 已由 Claude Agent SDK 承担。InkPress 不再自研 ToolLoopAgent，不再有外层 LLM intent router。

```text
WritingAssistant / useChat
  -> POST /api/ai/chat
      -> load target article/document
      -> getOrCreateAgentSession
      -> mergeAndPersistMessages
      -> local short-circuits
      -> code source preflight approval
      -> runClaudeAgentRuntime
          -> buildClaudeAgentOptions
              -> getClaudeAgentConfig
              -> listSkills
              -> createInkPressMcpServer
              -> buildInkPressSystemPrompt
              -> createPrismaSessionStore
          -> Claude Agent SDK query()
          -> agent-sdk-stream-adapter
          -> UIMessage parts
  -> WritingAssistant PART_RENDERERS
```

核心边界：

- Claude Agent SDK：负责识别用户真实意图、计划步骤、选择工具、工具循环、resume、autocompact。
- InkPress：负责文章/文档上下文、Skill 目录、MCP 工具、权限审批、提案/摘要写回、代码源授权、前端渲染。
- Vercel AI SDK：当前只作为 UIMessage stream / `useChat` 前端传输层，以及非主 agent 接口的模型调用能力；主 agent loop 不使用 Vercel AI SDK。

---

## 3. 模型配置加载

模型配置分两套，容易混淆。

### 3.1 Claude Agent Runtime 配置

主 agent 使用：

- `src/lib/ai/claude-agent-config.ts`
- SystemConfig key：`inkpress.claude-agent`
- 类型：`{ baseUrl, apiKey, model }`
- 默认：`https://open.bigmodel.cn/api/anthropic` + `glm-4.6`

调用链：

```text
buildClaudeAgentOptions()
  -> getClaudeAgentConfig()
      -> prisma.systemConfig.findUnique({ key: "inkpress.claude-agent" })
      -> parseClaudeAgentConfig()
  -> options.env.ANTHROPIC_BASE_URL
  -> options.env.ANTHROPIC_AUTH_TOKEN
  -> options.model
```

该配置用于 Claude Agent SDK 子进程。它不是普通聊天模型下拉里的 `inkpress.llm`。

### 3.2 普通 LLM 配置

非主 agent 接口使用：

- `src/lib/ai/llm-config.ts`
- `src/lib/ai/provider.ts`
- SystemConfig key：`inkpress.llm`
- 使用 `@ai-sdk/openai-compatible`

典型用途：

- `/api/ai/digest`
- `/api/skills/generate`
- `/api/ai/chat/compact`

注意：`/api/ai/chat` 主链路不会用 `getModel()` 构建 agent。它只保存前端传来的 `providerId/modelId` 到 session，作为 UI/兼容字段。

---

## 4. Agent Runtime 创建

### 4.1 `runClaudeAgentRuntime`

文件：`src/lib/ai/claude-agent-runtime.ts`

职责：

- 从 UIMessage 中取最近一条 user 文本作为 SDK `prompt`。
- 调 `buildClaudeAgentOptions()` 构造 SDK options。
- 创建 `AbortController` 桥接 HTTP request abort。
- 调 Claude Agent SDK `query({ prompt, options })`。
- 用 `createSdkToUiAdapter()` 将 SDKMessage 转为 UIMessage parts。
- 捕获限流错误，按配置整轮重试。

限流配置：

```text
INKPRESS_RATE_LIMIT_MAX_RETRIES      默认 10
INKPRESS_RATE_LIMIT_RETRY_WAIT_MS    默认 10 分钟
```

SDK 自身 `api_retry` 会被 adapter 映射为 `data-agent-retry { level: "sdk" }`；外层整轮重试会写 `data-agent-retry { level: "turn" }`。

### 4.2 `buildClaudeAgentOptions`

文件：`src/lib/ai/claude-agent-options.ts`

构造的关键 options：

```ts
{
  env,
  systemPrompt,
  model,
  cwd,
  includePartialMessages: true,
  mcpServers: { inkpress: mcpServer },
  allowedTools,
  canUseTool,
  tools: [],
  settingSources: [],
  persistSession: true,
  sessionStore,
  resume
}
```

重要设计：

- `tools: []`：禁用 SDK 内置 `Read/Edit/Bash/...`，只开放 InkPress MCP 工具。
- `settingSources: []`：不读取用户 `~/.claude` / 项目 `.claude` settings。
- `CLAUDE_CONFIG_DIR`：固定到 `~/.inkpress/cache/claude-agent/config`。
- `cwd`：固定到 `~/.inkpress/cache/claude-agent/workspace`。
- `persistSession + sessionStore + resume`：交给 SDK 管理多轮记忆和 autocompact。

---

## 5. 意图识别是如何设计的

当前没有外层 LLM 意图识别器。

### 5.1 本地短路

文件：

- `src/app/api/ai/chat/route.ts`
- `src/lib/ai/capability-reply.ts`
- `src/lib/ai/current-article.ts`

本地只做三类确定性短路：

| 场景 | 行为 |
|---|---|
| 用户问“你能做什么” | 直接返回能力说明 |
| 用户输入为空/误触/乱码 | 直接反问补充 |
| 用户指代当前文章但正文为空 | 直接提示当前文章为空 |

这些不是 LLM intent router，只是省 token、稳定体验的本地 guard。

### 5.2 代码源预检

`route.ts` 还会基于用户文本做代码源候选解析：

```text
extractCodeSourceCandidate(messageText, config.projects)
createOrReuseCodeSourceGrant()
codeSourceProject()
```

目的不是判断全部任务意图，而是确保未授权本地路径不能暴露给 agent。GitHub/configured project 可自动 approved，本地路径需要用户确认。

### 5.3 真正任务理解

真正的“用户要做什么、要加载哪个 Skill、调用哪个工具”交给 Claude Agent SDK 内部完成。InkPress 通过 `system-prompt.ts` 告诉它：

- 需要自己识别用户意图。
- 按需调用 `load_skill`。
- 修改文章必须用 `propose_*`。
- 需要素材时调用 `article_assets`。
- 没有联网工具时不要假装检索。

---

## 6. 工具注册与调用

### 6.1 工具注册表

文件：`src/lib/ai/tools/registry.ts`

当前工具：

| 工具 | 权限 | 作用 |
|---|---|---|
| `load_skill` | allow | 加载完整 Skill 手册 |
| `read_skill_resource` | allow | 读取 Skill 资源文件 |
| `article_assets` | allow | 查看当前文章素材 |
| `set_article_digest` | ask | 写回文章摘要 |
| `propose_article_revision` | allow | 创建/修改公众号文章 |
| `propose_technical_document_revision` | allow | 创建/修改技术文档 |
| `project_overview` | allow | 构建/读取项目索引 |
| `project_search` | allow | 搜索授权项目源码 |
| `project_read` | allow | 读取授权项目文件 |
| `project_glob` | allow | glob 列出授权项目文件 |
| `git_log` | allow | 读取授权项目提交历史 |
| `git_diff_summary` | allow | 读取提交范围变更摘要 |
| `github_pull_request` | allow | 读取 GitHub PR 信息 |

所有代码工具虽是 `allow`，但内部会调用 `requireProject(ctx)`，没有已授权 `codeSource` 会直接报错。

### 6.2 MCP server 包装

文件：`src/lib/ai/inkpress-mcp-server.ts`

每次 query 前都会用当前会话上下文创建 in-process MCP server：

```text
createInkPressMcpServer(ctx)
  -> INKPRESS_TOOLS.map(def => tool(...))
  -> createSdkMcpServer({ name: "inkpress", tools, alwaysLoad: true })
```

工具执行前后会直接写 UIMessage part：

- `tool-input-available`
- `tool-output-available`
- `tool-output-error`

这样前端能渲染工具卡，不依赖 SDK 是否把 tool_result 重新作为 stream message 暴露出来。

### 6.3 证据事件

部分代码工具会额外 emit：

- `data-project-snapshot`
- `data-source-evidence`
- `data-git-range`
- `data-commit-evidence`
- `data-change-evidence-summary`

前端在 `WritingAssistant.tsx` 的 `PART_RENDERERS` 里映射成 EvidenceChip。

---

## 7. Skill 加载

文件：`src/lib/ai/skills.ts`

Skill 存储是双根模型：

```text
systemSkillsDir() -> resourceRoot/resources/skills/system 只读，随 app 发布
userSkillsDir()   -> dataHome/resources/skills/user       可写，用户创建/上传
```

读取流程：

```text
listSkills()
  -> 扫 user + system 根目录
  -> 读取每个 SKILL.md frontmatter
  -> 返回 catalog

loadSkill(id)
  -> 匹配 id / skillKey / name
  -> 读取完整 SKILL.md manual
  -> 列出 resources

readSkillResource(id, path)
  -> 校验 path 非绝对、非越界、非二进制、大小限制
  -> 读取资源文本
```

限制：

- SKILL.md 最大 256KB。
- resource 最大 512KB。
- 资源读取必须在对应 Skill 目录内。
- `listSkills()` 有 5 秒 TTL 缓存，Skill 变更时调用 `invalidateSkillsCache()`。

Agent 如何知道 Skill：

- `buildInkPressSystemPrompt()` 注入 Skill 目录摘要。
- 用户斜杠命令 `/skill` 只会形成 `preferredSkillIds`，作为“建议优先加载”写入 system prompt。
- 真正是否调用 `load_skill` 仍由 Claude Agent 自己判断。

---

## 8. 权限审批

### 8.1 工具权限

文件：

- `src/lib/ai/permission-engine.ts`
- `src/lib/ai/claude-agent-options.ts`
- `src/lib/ai/pending-approvals.ts`
- `src/app/api/ai/agent-approvals/[id]/route.ts`
- `src/app/api/ai/agent-approvals/[id]/status/route.ts`
- `src/components/ai/ToolApprovalCard.tsx`

权限模型来自工具 registry：

```text
allow -> 放入 allowedTools，SDK 自动执行
ask   -> 不放入 allowedTools，触发 canUseTool
deny  -> 可放入 disallowedTools，当前本期为空
```

命中 ask 时：

```text
buildCanUseTool()
  -> 创建 ToolActionGrant(status=pending)
  -> emit data-tool-approval
  -> registerPendingApproval(grant.id)
  -> await 用户决定

ToolApprovalCard
  -> POST /api/ai/agent-approvals/{grantId}
  -> resolveApproval()
  -> canUseTool 返回 allow/deny
  -> 同一条 in-flight query 继续
```

当前 `ask` 工具主要是 `set_article_digest`。

局限：

- pending approval resolver 存在进程内 Map，多实例/进程重启会丢。
- DB grant 仍存在，status API 有 10 分钟 TTL，防止 composer 永久锁死。

### 8.2 代码源权限

文件：

- `src/lib/ai/code-source.ts`
- `src/app/api/ai/code-sources/[id]/approve/route.ts`
- `src/app/api/ai/code-sources/[id]/status/route.ts`
- `WritingAssistant.tsx` 内 `CodeSourceApprovalCard`

流程：

```text
route.ts
  -> extractCodeSourceCandidate()
  -> createOrReuseCodeSourceGrant()
      - github/configured 自动 approved
      - local path pending，需要用户授权
  -> approved 时 codeSourceProject()
  -> pending 时 emit data-code-source-approval 并 early return
```

用户批准后，前端会触发再次发送/恢复逻辑；下一轮 route 复用已 approved grant，并把 `codeSource` 注入 runtime。

---

## 9. 上下文与系统提示

文件：`src/lib/ai/system-prompt.ts`

系统提示包括：

- 当前目标：文章或技术文档标题。
- 当前正文 Markdown，最长注入 `ARTICLE_BODY_BUDGET = 12000` 字符，超长截断。
- 可用工具说明。
- 写作约定。
- Skill 目录摘要。
- 斜杠命令建议优先加载的 Skill。
- 已授权代码源时追加代码探索工具说明。

注意：

- 当前完整正文不是通过 `prepareAgentContext()` 压缩后传入主链路，而是在 system prompt 动态段注入。
- 正文超长时只注入前 12000 字符；长期对话上下文交给 Claude Agent SDK session/autocompact。
- 如果没有 Web 工具，system prompt 要求 agent 明确说明不能直接检索外部资料。

---

## 10. 多轮对话与存储

### 10.1 UIMessage 历史

文件：`src/lib/ai/chat-persistence.ts`

数据库表：

- `AgentChatSession`
- `AgentChatMessage`

设计点：

- 一个 article 或 technical-document 对应一个 `AgentChatSession`。
- `mergeAndPersistMessages()` 合并前端消息和 DB 历史，避免前端分页/remount 后只带最近消息，导致旧历史被覆盖删除。
- `loadAgentMessages()` 支持分页加载最近消息。
- `normalizeLoadedParts()` 会把历史中仍处 input-streaming/input-available 的工具 part 统一转为 output-available，避免永久 spinner。

### 10.2 Claude Agent SDK SessionStore

文件：`src/lib/ai/claude-session-store.ts`

数据库表：

- `ClaudeAgentSessionEntry`

作用：

- `persistSession: true` 时，SDK transcript entry 会 append 到 SessionStore。
- `resume: session.claudeAgentSessionId` 时，SDK 可以恢复原生会话。
- 有 uuid 的 entry 幂等 upsert，无 uuid 的 entry 直接追加。
- `subpath` 预留给子 agent transcript。

`AgentChatSession.claudeAgentSessionId` 在每轮 `runClaudeAgentRuntime()` 返回后写入，用于下一轮 resume。

---

## 11. 压缩设计

当前有两套“压缩相关”机制。

### 11.1 主链路：Claude Agent SDK autocompact

主 agent 回话依赖 SDK 自己的 autocompact 和 SessionStore。SDK 发出的 compact 事件由 `agent-sdk-stream-adapter.ts` 映射为：

- `system.status compacting` -> `data-agent-step`：正在压缩上下文
- `system.compact_boundary` -> `data-agent-step`：上下文已自动压缩，显示 pre/post tokens

前端复用 `AgentStepBlock` 渲染。

### 11.2 手动 `/compact`

文件：

- `src/app/api/ai/chat/compact/route.ts`
- `src/lib/ai/context-manager.ts`

手动 `/compact` 使用普通 LLM 配置 `inkpress.llm`，调用 `summarizeConversation()`：

```text
loadAllAgentMessages()
getModel(providerId, modelId)
summarizeConversation({
  keepRecent: 4,
  deleteSummarized: true
})
```

它会把旧 UIMessage 历史总结到 `AgentChatSession.summary`，删除已摘要覆盖的旧消息并重排 position。

注意：

- `prepareAgentContext()` 是旧 native/context 机制的遗留能力，主 `/api/ai/chat` 当前不调用。
- `estimateTokens()` 仍被主链路用于 context usage 估算和超长正文提示。

---

## 12. 前端回话窗口如何渲染

主要文件：

- `src/components/editor/WritingAssistant.tsx`
- `src/components/ai/ToolCallBlock.tsx`
- `src/components/ai/ToolGroupBlock.tsx`
- `src/components/ai/ToolApprovalCard.tsx`
- `src/components/ai/AgentStepBlock.tsx`
- `src/components/ai/ReasoningBlock.tsx`
- `src/components/ai/RetryIndicator.tsx`
- `src/components/ai/tool-helpers.tsx`

`WritingAssistant.tsx` 中的 `PART_RENDERERS` 是渲染注册表。它把 UIMessage parts 映射为：

| part 类型 | 前端组件 |
|---|---|
| `text` | Markdown 输出或用户气泡 |
| `reasoning` | ReasoningBlock |
| `tool-*` / `dynamic-tool` | ToolCallBlock / ProposalCard / DirectWriteNotice |
| `data-tool-approval` | ToolApprovalCard |
| `data-code-source-approval` | CodeSourceApprovalCard |
| `data-agent-retry` | RetryIndicator |
| `data-agent-step` | AgentStepBlock |
| `data-context-usage` | ContextUsageLine |
| `data-*evidence*` | EvidenceChip |

前端还会扫描最新 assistant message：

- 查 pending code source/tool approval，锁定 composer。
- 查最新 `data-context-usage` 更新 token meter。
- 查 `propose_article_revision` direct 模式，首次生成时直接写入编辑器。
- 查 `data-article-digest`，同步摘要字段。

---

## 13. 写作产出与提案

文章和技术文档修改不直接让 agent 操作编辑器，而是通过工具：

```text
propose_article_revision
propose_technical_document_revision
```

公众号文章：

- 当前编辑器为空：工具返回 `{ mode: "direct", markdown, title, digest }`，前端直接写入。
- 当前已有正文：工具创建 `AgentArticleProposal`，前端显示 ProposalCard，用户 diff 审查后应用。

技术文档：

- 工具创建 `AgentTechnicalDocumentProposal`。
- apply 时会写入技术文档版本，并保留 source snapshot / code source 信息。

---

## 14. 如何调试一轮 agent 回话

### 14.1 后端日志顺序

从 `POST /api/ai/chat` 开始看：

1. `Agent 对话开始` 日志：确认 session、target、消息数量。
2. 是否命中本地短路：capability / clarify / empty article。
3. 是否 emit 代码源 detected/approval/ready。
4. 是否 emit current article/context usage。
5. 是否进入 `runClaudeAgentRuntime()`。
6. SDK `system.init` 是否显示模型和工具数。
7. MCP 工具是否出现 input/output part。
8. result 是否返回 session id 和 usage。

### 14.2 常见问题定位

| 现象 | 首查位置 |
|---|---|
| 提示未配置 Claude Agent API Key | `claude-agent-config.ts` / 设置页 `inkpress.claude-agent` |
| 普通 `/compact` 报模型未配置 | `inkpress.llm` / `provider.ts` |
| Skill 不出现 | `skills.ts`、`systemSkillsDir()`、`userSkillsDir()`、缓存失效 |
| 工具不显示 | `inkpress-mcp-server.ts` 是否 emit tool parts，`PART_RENDERERS` 是否命中 |
| 工具一直转圈 | `normalizeLoadedParts()`、历史 part state、SDK 流是否中断 |
| 本地项目读不了 | `code-source.ts` grant status、path validation、是否传入 `codeSource` |
| 多轮失忆 | `AgentChatSession.claudeAgentSessionId`、`ClaudeAgentSessionEntry`、`resume` |
| autocompact 无 UI | `agent-sdk-stream-adapter.ts` system.status/compact_boundary 映射 |
| 审批后不继续 | `pending-approvals.ts` 进程内 resolver 是否还在，POST 返回 `woken` 是否 true |

---

## 15. 当前明确缺口

这些不是 bug，但阅读代码时要知道：

- 没有外部 Web MCP 工具；SDK 内置工具也被 `tools: []` 禁用，所以 agent 目前不能真正联网检索。
- 没有外层 LLM intent router，这是有意设计；任务理解交给 Claude Agent SDK。
- `prepareAgentContext()` 不在主链路使用，主要保留给手动 `/compact` 和历史测试。
- `sessionStore` 是 Claude Agent SDK alpha 接口，升级 SDK 时优先检查 `claude-session-store.ts`。
- 工具 display 元数据主要还在前端 `tool-helpers.tsx`，后续 PDC 建议迁到后端 registry。
- 工具审批 resolver 是进程内 Map，多实例部署需要替换为可恢复队列/会话控制机制。

---

## 16. 最小阅读任务清单

如果一个 AI 开发者只想快速接手，请按顺序完成：

1. 读 `src/app/api/ai/chat/route.ts`，画出 POST 主流程。
2. 读 `src/lib/ai/claude-agent-options.ts`，列出 SDK options 每个字段的来源。
3. 读 `src/lib/ai/tools/registry.ts`，列出当前工具、权限和是否需要 `codeSource`。
4. 读 `src/lib/ai/skills.ts`，确认 system/user Skill 路径和安全限制。
5. 读 `src/lib/ai/chat-persistence.ts`，理解 `mergeAndPersistMessages()` 为什么不能简单覆盖。
6. 读 `src/lib/ai/claude-session-store.ts`，理解 SDK resume 与 UIMessage 历史是两套存储。
7. 读 `src/components/editor/WritingAssistant.tsx` 的 `PART_RENDERERS`，理解每种 part 如何渲染。
8. 读 `docs/agent-runtime-pdc.md`，了解下一步增强方向。

