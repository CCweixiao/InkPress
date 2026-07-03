# Review 指引：模型配置统一收口（全面 Anthropic 协议 + 删除摘要独立入口）

## 一、变更目标

将两套割裂的大模型配置（`inkpress.llm` 多 provider 数组 vs `inkpress.claude-agent` 单一后端）统一收口到 `inkpress.llm`，全部走 Anthropic `/messages` 协议。聊天框模型选择器选什么就生效，删除 digest 独立触发入口。

## 二、逐文件 Review 要点

### 核心协议切换（风险：中）

| 文件 | 行号 | 关注点 |
|---|---|---|
| `src/lib/ai/provider.ts` | 41-45 | `createAnthropic({ baseURL, apiKey })` 是否正确传入 `config.baseUrl` / `config.apiKey`；注意 `createAnthropic` 会自动在 baseURL 后追加 `/v1/messages`，GLM 端点 `https://open.bigmodel.cn/api/anthropic` 已被 Claude Agent SDK 验证路径一致 |
| `package.json` | 42 | 确认 `@ai-sdk/anthropic@^3.0.91`（**不是 v4**）。v4 返回 `LanguageModelV4` 与 `ai@6.0.208` 的 `LanguageModel` 类型（`V2\|V3`）不兼容，typecheck 会报 TS2322 |

### Agent 动态注入（风险：中）

| 文件 | 行号 | 关注点 |
|---|---|---|
| `src/lib/ai/claude-agent-options.ts` | 253 | `chooseLlmConfig(input.providerId, input.modelId)` 替代了原来的 `getClaudeAgentConfig()`。null 返回时抛"未配置 AI 模型"错误 |
| 同上 | 278-279 | env 注入改为 `ANTHROPIC_BASE_URL: selected.baseUrl` / `ANTHROPIC_AUTH_TOKEN: selected.apiKey` |
| 同上 | 295 | model 改为 `selected.model.id`（原来是 `cfg.model` 字符串） |
| `src/lib/ai/claude-agent-runtime.ts` | 39-42 | `RunClaudeAgentInput` 新增 `providerId?` / `modelId?` 字段，`runOnce` 透传给 `buildClaudeAgentOptions` |
| `src/app/api/ai/chat/route.ts` | 689-707 | **跨模型 resume 检测**：`modelChanged` 运算符优先级是否正确（`&&` 包裹 `claudeAgentSessionId`，`\|\|` 在 provider/model 变化内层）；变化时 `effectiveClaudeAgentSessionId = undefined` 强制新会话 + emit 提示 |
| 同上 | 726-727 | `providerId: newProviderId` / `modelId: newModelId` 传入 runtime |

### 配置迁移与回落（风险：中）

| 文件 | 行号 | 关注点 |
|---|---|---|
| `src/lib/ai/llm-config.ts` | 13 | 私有常量 `CLAUDE_AGENT_CONFIG_KEY`（不导出，仅供迁移/回落用） |
| 同上 | 199-213 | `getLlmConfigs()` 新增回落：inkpress.llm 为空/解析失败 → `tryClaudeAgentFallback()` 构造临时 LlmConfig |
| 同上 | 260-330 | `migrateClaudeAgentConfig()`：幂等标记 `claude-agent-migrated`；`llmWasEmpty` 时首个模型设为 default；**不删旧 key**（留备份） |
| `src/lib/init.ts` | 65-68, 119-122, 126-131 | 迁移在 dev 模式和打包模式两条路径都执行；用动态 `import("@/lib/ai/llm-config")` 避免顶层 prisma 加载 |

### UI 清理（风险：低）

| 文件 | 关注点 |
|---|---|
| `src/components/settings/SystemConfigManager.tsx` | `ClaudeAgentEditor` 组件、`ClaudeAgentForm` 类型、`DEFAULT_CLAUDE_AGENT`、`parseClaudeAgentValue`、`claudeAgentConfig` find、`claudeAgentForm` state/effect/memo、`saveClaudeAgent`、`CLAUDE_AGENT_CONFIG_KEY` 导出 — 全部删除，搜索 `ClaudeAgent` 应无残留 |
| 同上 line ~1757 | apiProvider 输入框 → 只读 `<Badge>Anthropic /messages</Badge>`，旧配置（`apiProvider !== "anthropic"`）显示橙色警告 |
| 同上 line 136 / 252 | `EMPTY_LLM_PROVIDER.apiProvider` 和 `parseLlmValue` 回落值改为 `"anthropic"` |
| `src/data/llm-presets.json` | 3 个 anthropic 预设：`anthropic`（api.anthropic.com）、`zhipu-glm`（open.bigmodel.cn/api/anthropic）、`openrouter`（openrouter.ai/api/v1） |
| `src/components/publish/PublishDialog.tsx` | 删除 `handleGenerateDigest`、`digestGenerating` state、AI 生成按钮、`Sparkles` import；placeholder 引导 `/article-summary` |

### 文件删除与分支清理

| 文件 | 关注点 |
|---|---|
| `src/lib/ai/claude-agent-config.ts` | **已删除**。`getClaudeAgentConfig` / `parseClaudeAgentConfig` / `CLAUDE_AGENT_CONFIG_KEY` 逻辑 inline 到 `llm-config.ts` 作私有函数 |
| `src/app/api/system-config/route.ts` | 删除 import（~line 18）、validateConfigValue 分支（~line 46）、maskConfigs 分支（~line 145）、PUT merge 列表（~line 233）、mergeMaskedSecrets 分支（~line 312）共 5 处 CLAUDE_AGENT 引用 |
| `src/app/api/ai/digest/route.ts` | **整个文件 + 目录已删除** |
| `scripts/probe-mcp.ts` / `scripts/probe-can-use-tool.ts` | import 从 `getClaudeAgentConfig` → `chooseLlmConfig`；`cfg.model` → `cfg.model.id` |

## 三、重点验证项

### 自动化验证（已通过）

- `pnpm typecheck` — 0 errors
- `pnpm test` — 34 files / 284 tests passed

### 手动验证建议

1. **连通性**：配置一个 anthropic provider（如 GLM `https://open.bigmodel.cn/api/anthropic` + apiKey），在对话框发消息验证正常回复
2. **模型选择器生效**：切换 provider/model 后发消息，确认实际使用了所选模型（检查日志 `providerId` / `modelId`）
3. **跨模型 resume**：切换模型后发消息，观察 UI 出现"模型已切换，开启新的 Agent 会话"提示，日志中 `claudeAgentSessionId` 为新值
4. **配置迁移**：DB 中仅有 `inkpress.claude-agent` 无 `inkpress.llm` 时启动，检查 `inkpress.llm` 自动生成含 `claude-agent-migrated` provider
5. **设置页**：agent tab 下无 ClaudeAgentEditor；llm tab 的 apiProvider 显示只读 Badge；预设下拉只有 3 个 anthropic 选项
6. **PublishDialog**：无"AI 生成"按钮；摘要框 placeholder 提示 `/article-summary`
7. **article-summary skill**：对话框输入 `/article-summary` 能生成摘要并通过 `set_article_digest` MCP 工具写回

## 四、已知风险与缓解

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| 现有 openai-compatible 配置失效（baseUrl 指向 `/api/paas/v4` 等非 anthropic 端点） | **高** | 设置页 LlmEditor 对 `apiProvider !== "anthropic"` 显示橙色警告；发版说明需列出 baseUrl 对照表 |
| `createAnthropic` baseURL 路径 | 中 | GLM 端点已被 Claude Agent SDK 验证可用；需手动连通测试确认 `@ai-sdk/anthropic` 走相同路径 |
| 跨厂商 resume crash | 中 | chat route 检测 model 变化 → 强制新会话 + emit 提示 |
| 删除 digest 后用户找不到入口 | 低 | placeholder 引导 + `article-summary` skill 已就绪 |

## 五、全量残留搜索（已验证清洁）

以下关键词在 `src/` + `scripts/` 中应无残留（`llm-config.ts` 内私有 `CLAUDE_AGENT_CONFIG_KEY` 除外）：

```
openai-compatible / createOpenAICompatible / getClaudeAgentConfig / claude-agent-config
```

`docs/` 和 `README.md` 中仍有旧描述，本次未改（文档不影响运行时）。
