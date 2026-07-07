# web_fetch 在 GLM 下"模型误报失败"问题 Review

> 自包含文档：另一个 AI 无需访问代码库即可理解。关键代码片段已内联。

## TL;DR

InkPress 的 `web_fetch` MCP 工具**实际执行成功并返回了 8000 字真实内容**，但 **GLM-4.6 模型在思考/输出中反复报告"web_fetch failed / had errors"**。强烈怀疑是 **GLM 对 MCP 工具 `tool_result` 的处理不可靠**，或 **SDK 没把 in-process MCP 工具的 `CallToolResult` 正确转成 Anthropic `tool_result` block 回流给模型**。需排查 SDK 层 tool_result 的传递，或用官方 Claude 模型做对照实验。

---

## 1. 症状

- Claude Agent（后端 GLM-4.6）在调研流程中调用 `mcp__inkpress__web_fetch`。
- 工具**实际成功**（见证据），但模型在 reasoning/text 里反复说：
  - "The web_fetch tool had errors. Let me try fetching from other URLs..."
  - "The web_fetch is failing. Let me try other URLs or try different approaches."
  - "The web_fetch calls failed. Let me try fetching the official docs again..."
- 用户感知：web_fetch"报错"。

## 2. 证据（来自 dev.db 持久化数据，铁证）

对 SQLite `dev.db` 查询结果：

```
ToolActionGrant（权限闸门）：
  web_fetch | approved | 2026-06-30 11:21:36   ← 弹了审批卡，用户点了同意
  web_fetch | approved | 2026-06-30 11:21:37   ← 同上

dynamic-tool part（web_fetch 执行结果）：
  state=output-available | url=https://code.claude.com/docs/en/agent-sdk/overview
    | title="Agent SDK overview - Claude Code Docs" | textLen=8000
    head: "Agent SDK overview - Claude Code Docs Documentation Index..."
  state=output-available | url=https://www.silverthreadlabs.com/blog/ai-agent-sdks-compared
    | title="Claude Agent SDK vs OpenAI Agents SDK vs..." | textLen=8000
    head: "Claude Agent SDK vs OpenAI Agents SDK vs Google ADK (2025)..."

tool-output-error part（web_fetch）：无任何记录
```

即：**2 次 web_fetch 全部 `output-available`（成功），各 8000 字真实内容，零失败**。

本地直接跑 `fetchWebPage("https://code.claude.com/docs/en/agent-sdk/overview")` 也成功拿到 2000 字真实文档。

**结论：web_fetch 工具链路（SSRF 守卫 → fetch → HTML 抽取 → MCP 返回 → 权限闸门）完全正常。问题在模型侧。**

## 3. 环境

- SDK：`@anthropic-ai/claude-agent-sdk`（query 流式）
- 模型后端：GLM-4.6 via 智谱 BigModel `https://open.bigmodel.cn/api/anthropic`（Anthropic Messages 兼容端点），经 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 注入
- web_fetch 是 **in-process MCP 工具**（`createSdkMcpServer`，非外部 stdio MCP）
- `options.tools = []`（禁用所有内置工具，只用 InkPress MCP）
- `options.canUseTool` 自定义（权限闸门）
- `options.includePartialMessages = true`

## 4. 工具链路（代码路径）

```
SDK query() → 模型 tool_use(mcp__inkpress__web_fetch)
  → SDK canUseTool (claude-agent-options.ts buildCanUseTool)
      web_fetch permission="ask" → 建 ToolActionGrant + emit data-tool-approval + await 用户
      → 用户同意 → return {behavior:"allow", updatedInput}
  → SDK 执行 MCP 工具 (inkpress-mcp-server.ts tool handler)
      ctx.emit tool-input-available / tool-output-available（直接写 UI 流，给前端看）
      return CallToolResult { content:[{type:"text",text}], structuredContent, isError:false }
  → SDK 把 CallToolResult 转成 tool_result 发给模型  ← ★ 怀疑点
  → 模型继续推理（GLM 在这里误报 failed）
```

UI 流的 `tool-output-available` 是 `ctx.emit` **直接写**的（不经 stream adapter），所以前端能看到 8000 字。但**模型是否收到 tool_result 是 SDK 内部行为**，前端看不到。

## 5. 关键代码片段

### 5.1 web_fetch 工具（`src/lib/ai/tools/registry.ts`）

```ts
const webFetchTool: InkPressToolDefinition = {
  name: "web_fetch",
  permission: "ask",            // 走 canUseTool 审批闸门
  category: "web",
  version: "1.0.0",
  display: webFetchDisplay,
  toContentText: (result) => {   // 把结果转成给模型的纯文本（已从 JSON 改造）
    const r = (result ?? {}) as { title?: string; url?: string; text?: string };
    return `# ${r.title ?? r.url ?? "网页正文"}\n来源：${r.url ?? ""}\n\n${r.text ?? ""}`;
  },
  description: "读取指定网页正文（去标签后的纯文本）...",
  inputSchema: { url: z.string().url(), maxChars: z.number().int().min(500).max(20000).optional() },
  annotations: { readOnlyHint: true, openWorldHint: true },
  execute: async (ctx, args) => {
    const result = await fetchWebPage({ url: String(args.url ?? ""), maxChars: ... });
    ctx.emit({ type: "data-web-source", id: result.url, data: {...} } as never);
    return { url: result.url, title: result.title, text: result.text };
  },
};
```

### 5.2 MCP 包装（`src/lib/ai/inkpress-mcp-server.ts`）

```ts
const tools = INKPRESS_TOOLS.map((def) =>
  tool(def.name, description, def.inputSchema,
    async (args) => {
      const toolCallId = crypto.randomUUID();
      const displayCtx = { target: { kind, id, title } };
      ctx.emit({ type: "tool-input-available", toolCallId, toolName: def.name, input: args, dynamic: true, toolMetadata:{display: inputDisplay} } as never);
      try {
        const result = await def.execute(ctx, args);
        ctx.emit({ type: "tool-output-available", toolCallId, output: result, dynamic: true, toolMetadata:{display: outputDisplay} } as never);
        const structured = result && typeof result === "object" ? result : undefined;
        const textResult = def.toContentText ? def.toContentText(result) : (typeof result === "string" ? result : JSON.stringify(result));
        return {
          content: [{ type: "text", text: textResult }],
          structuredContent: structured,
          isError: false,             // ← 成功时 isError=false
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "工具执行失败。";
        ctx.emit({ type: "tool-output-error", toolCallId, errorText: message, dynamic: true, toolMetadata:{display:errorDisplay} } as never);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
    def.annotations ? { annotations: def.annotations } : undefined
  )
);
return createSdkMcpServer({ name: "inkpress", tools, alwaysLoad: true });
```

### 5.3 options 组装（`src/lib/ai/claude-agent-options.ts`，节选）

```ts
return {
  env: { ...process.env, ANTHROPIC_BASE_URL: cfg.baseUrl, ANTHROPIC_AUTH_TOKEN: cfg.apiKey, ANTHROPIC_API_KEY: undefined, CLAUDE_CONFIG_DIR: ... },
  systemPrompt: buildInkPressSystemPrompt({...}),
  model: cfg.model,                     // "glm-4.6"
  cwd: claudeWorkspaceDir,
  includePartialMessages: true,
  mcpServers: { inkpress: mcpServer },
  allowedTools: claudeAllowedTools({ webFetchAutoApprove }),  // web_fetch 不在其中（permission=ask）
  canUseTool: buildCanUseTool({ sessionId, emit, autoApprove }),
  tools: [],                            // 禁用内置工具
  settingSources: [],
  persistSession: true,
  sessionStore: createPrismaSessionStore(),
  ...(claudeAgentSessionId ? { resume: claudeAgentSessionId } : {}),
};
```

### 5.4 stream adapter（`src/lib/ai/agent-sdk-stream-adapter.ts`）

**只处理 text / reasoning / system / result 消息**，**不处理 tool_use / tool_result**（MCP 工具的 part 由 `ctx.emit` 直接写 UI 流，绕过 adapter）。所以 adapter 不是问题。

## 6. 已尝试的修复（均未解决"模型误报"）

1. `fetchWebPage` 的 `User-Agent` 从 `InkPressAgent/1.0` 改成浏览器化 `Mozilla/5.0 ... Chrome/120`（排除反爬 403）—— 工具本就成功，无效。
2. `fetchWebPage` 错误信息细化（超时/网络/状态码分开）—— 没有 error 产生，无效。
3. web_fetch 给模型的 `content[0].text` 从 `JSON.stringify({url,title,text})` 改成纯文本 `# 标题\n来源：URL\n\n正文`（新增 `toContentText` 机制）—— **怀疑这能帮 GLM，但用户重测后模型仍报 failed**。

## 7. 排查结论

- ✅ web_fetch 执行正常（dev.db 铁证）
- ✅ 权限闸门正常（grant approved）
- ✅ MCP handler 返回 `isError:false` + 内容
- ❓ **SDK 是否把 CallToolResult 正确转成 Anthropic `tool_result` content block 发给 GLM** —— 未验证
- ❓ **GLM 是否正确消费 `tool_result`** —— 高度怀疑（GLM 工具调用可靠性本就弱）

## 8. 怀疑根因（按可能性排序）

1. **GLM-4.6 对 MCP 工具的 tool_result 处理不可靠**：拿到内容却推理成"失败"，或多轮工具调用后状态混乱、忘记已成功调过。这是 GLM 的已知短板（官方 Claude 不会有此问题）。
2. **SDK 对 in-process MCP（`createSdkMcpServer`）工具结果的回传格式**：CallToolResult 的 `content`/`structuredContent`/`isError` 如何映射到 Anthropic Messages API 的 `tool_result` block？若 SDK 用了 `structuredContent`（GLM 可能不认）而非 `content[0].text`，GLM 可能解析失败。
3. **`tool_use_id` 配对**：SDK 生成的 toolCallId（`crypto.randomUUID()`，仅 UI 用）与模型 tool_use 的 id 是否正确配对在 tool_result 里？若不配对，模型认为工具没返回。
4. **`includePartialMessages` 或 streaming 模式**下，tool_result 是否完整发送（而非被 partial 截断）。

## 9. 建议排查 / 修复步骤（给下一个 AI）

### 9.1 决定性对照实验（先做）
把后端切到**官方 Anthropic**（`baseUrl=https://api.anthropic.com`, `model=claude-sonnet-4-6`, 真 key），重发同样请求。
- 若 Claude 下 web_fetch **不再误报 failed** → 100% 锁定是 **GLM 模型问题**，InkPress 代码无 bug。建议：文档注明"工具重度场景用官方 Claude，GLM 适合轻量问答"。
- 若 Claude 下**也误报** → 是 InkPress/SDK 的 bug，继续 9.2。

### 9.2 抓 SDK 发给模型的原始请求
在 `claude-agent-options.ts` 的 `options` 里加 `stderr` 或用代理抓包，看 SDK 发给 GLM 的 Messages API 请求体里：
- `tool_use` block 的 id
- 对应的 `tool_result` block 是否存在、`is_error` 是否 false、`content` 是什么
- 确认 tool_use_id 配对正确

### 9.3 检查 SDK 的 MCP result → tool_result 映射
查 `@anthropic-ai/claude-agent-sdk` 源码（node_modules）：`createSdkMcpServer` 的工具 CallToolResult 如何被转成发给模型的 tool_result。重点：
- 用 `content[0].text` 还是 `structuredContent`？
- `isError:false` 是否正确映射？
- in-process MCP 与 stdio MCP 的 result 处理是否一致？

### 9.4 可能的修复（若 9.2/9.3 发现问题）
- 若 SDK 用 structuredContent 而 GLM 不认：让 web_fetch 不返回 structuredContent（只 content[0].text），看 `inkpress-mcp-server.ts` 能否对 GLM 端点特化。
- 若 tool_use_id 不配对：用 SDK 传入的真实 tool_use_id（而非自生成 UUID）做 UI 聚合。
- 若 GLM 多轮工具调用混乱：限制单轮 web_fetch 次数，或在 system-prompt 强化"web_fetch 返回的内容就是最终结果，不要重复抓取同一类信息"。

### 9.5 兜底（若确属 GLM 不可靠且无法修）
- system-prompt 加强约束："调用 web_fetch 后，若 tool_result 含正文，直接引用，不要判定为失败或重复调用。"
- UI 层：当检测到"web_fetch 成功但模型说 failed"时，给用户提示"模型可能误判，工具实际成功（见工具卡输出）"。

## 10. 关键文件清单

| 文件 | 作用 |
|---|---|
| `src/lib/ai/tools/registry.ts` | web_fetch 工具定义（permission/toContentText/execute） |
| `src/lib/ai/inkpress-mcp-server.ts` | MCP 包装（CallToolResult 返回） |
| `src/lib/ai/claude-agent-options.ts` | options 组装（env/model/mcpServers/canUseTool/allowedTools） |
| `src/lib/ai/agent-sdk-stream-adapter.ts` | SDK message → UI parts（不处理 tool_result） |
| `src/lib/ai/tools/web-research.ts` | fetchWebPage 实现 |
| `src/lib/ai/web-allowlist.ts` | 域名白名单（autoApprove=false 时 web_fetch 走审批） |
| `src/lib/ai/permission-engine.ts` | 权限决策 |
| `src/app/api/ai/chat/route.ts` | 主入口 |

## 11. 包版本
- `@anthropic-ai/claude-agent-sdk`：见 package.json（0.3.x 系列）
- `ai`（Vercel AI SDK）：用于 UIMessage stream
- 后端：GLM-4.6 @ BigModel `/anthropic`

---

**给下一个 AI 的提示**：先做 §9.1 的对照实验（换官方 Claude）。这是 1 小时内能给出定论的最快路径。如果锁定是 GLM 问题，就没有代码 bug 可修——只能换模型或在 prompt/UI 层兜底。如果官方 Claude 也复现，再深入 §9.2/9.3 抓 SDK 原始请求。
