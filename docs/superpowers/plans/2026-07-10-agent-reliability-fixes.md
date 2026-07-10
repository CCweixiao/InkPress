# InkPress Agent 可靠性与写入一致性实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 消除文章生成链路中已确认的数据丢失、重复执行、错误收口与长文上下文缺失风险，并补齐可观测性与回归测试。

**架构：** 保持 Claude Agent SDK 负责 Agent loop。应用层新增两类稳定边界：文章内容的 revision/CAS，以及聊天轮次的 `turnId + lease`。运行时使用单一 deadline/turn envelope，SDK 原生处理 API retry；adapter 以 SDK message ID 为来源归并事件并显式报告终态。所有生成均产出提案，只有确认 API 才更新正文。

**技术栈：** Next.js Route Handlers、TypeScript、Prisma/SQLite、Vitest、Claude Agent SDK。

---

## 变更范围与约束

- **页面类型：** 既有编辑器与既有 API，不新增列表页/表单页；不适用 `templates/scene-list.md`、`templates/scene-form.md`、`templates/common-page.md`。
- **规则文件：** 未发现 `.cursor/rules/001-ai-friendly-standard.mdc`；遵循现有 TypeScript、Prisma 和 Route Handler 模式。
- **组件与接口边界：** `EditorWorkspace` 仅负责顺序 autosave 与版本跟踪；文章 API 负责 CAS；提案 apply 负责原子 claim；chat route 负责 turn lease；runtime/adapter 不直接写 UI 或数据库。
- **验收：** 每项先添加能失败的单测；提交前运行关联测试、`pnpm typecheck`、`pnpm lint`、`pnpm test`。

### 任务 1：为文章保存与提案应用建立 revision/CAS

**文件：**

- 修改：`prisma/schema.prisma`
- 创建：`prisma/migrations/20260710000000_article_content_revision/migration.sql`
- 修改：`src/app/api/articles/[id]/route.ts`
- 修改：`src/app/api/ai/proposals/[id]/apply/route.ts`
- 修改：`src/components/editor/EditorWorkspace.tsx`
- 创建：`tests/unit/article-content-revision.test.ts`

- [ ] **步骤 1：编写失败的 CAS 回归测试**

```ts
it("rejects an autosave whose expected revision is stale", async () => {
  const result = await updateArticleContent({
    articleId: "article-1",
    contentMd: "old save",
    expectedContentRevision: 3,
  });

  expect(result).toMatchObject({ ok: false, reason: "revision-conflict" });
  expect(readArticleContent("article-1")).resolves.toBe("new proposal content");
});

it("allows only one proposal based on the same content revision to apply", async () => {
  await Promise.allSettled([applyProposal("proposal-a"), applyProposal("proposal-b")]);
  expect(appliedProposalIds()).toEqual([expect.stringMatching(/^proposal-[ab]$/)]);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm vitest run tests/unit/article-content-revision.test.ts`

预期：FAIL，缺少 `expectedContentRevision` 协议或两个提案均可写入。

- [ ] **步骤 3：增加内容 revision 并实现 CAS**

```prisma
model Article {
  // ...
  contentRevision Int @default(0)
}
```

```ts
const updateSchema = z.object({
  // ...
  expectedContentRevision: z.number().int().nonnegative().optional(),
});

const claimed = await prisma.article.updateMany({
  where: { id, contentRevision: expectedContentRevision },
  data: { contentRevision: { increment: 1 }, ...(contentPath ? {} : { contentPath: rel }) },
});
if (claimed.count !== 1) {
  return NextResponse.json({ error: "文章已更新，请刷新后重试。", code: "revision-conflict" }, { status: 409 });
}
await writeContentAt(rel, contentMd);
```

提案 apply 在读取当前正文后，以 `articleId + contentRevision + pending` 原子 claim；写入失败只回滚自身已 claim 的状态，不回写可能已被后续修改的正文。`EditorWorkspace` 为每次成功响应更新 revision，保存请求串行化；409 或网络失败保留 dirty 状态并显示可重试。

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm vitest run tests/unit/article-content-revision.test.ts tests/unit/article-proposal-tool.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add prisma src/app/api/articles src/app/api/ai/proposals src/components/editor/EditorWorkspace.tsx tests/unit/article-content-revision.test.ts
git commit -m "fix: protect article content with revisions"
```

### 任务 2：防止初始化、分页和 clear 造成聊天记录覆盖

**文件：**

- 修改：`src/components/editor/WritingAssistant.tsx`
- 修改：`src/components/editor/ChatComposer.tsx`
- 修改：`src/lib/ai/chat-persistence.ts`
- 修改：`src/app/api/ai/chat/route.ts`
- 修改：`tests/unit/chat-persistence.test.ts`
- 创建：`tests/unit/chat-session-race.test.ts`

- [ ] **步骤 1：编写失败的聊天一致性测试**

```ts
it("does not delete persisted history when an initializing client posts disjoint messages", () => {
  expect(computeMergedMessages(persistedTen, [newUserMessage])).toMatchObject({
    conflict: "initializing-client",
    messages: persistedTen,
  });
});

it("keeps the loaded page when a completed turn refreshes only its newest tail", () => {
  expect(mergeFinishedMessages(firstTen, newestTen)).toHaveLength(12);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm vitest run tests/unit/chat-persistence.test.ts tests/unit/chat-session-race.test.ts`

预期：FAIL，当前无交集会删除旧历史，finished refresh 会替换为最新页。

- [ ] **步骤 3：实现客户端禁发、服务端冲突保护与 epoch**

```ts
if (relation === "disjoint" && persisted.length > 0) {
  return { conflict: "initializing-client", messages: persisted };
}
```

初始化未完成时禁用 composer。POST/DELETE 携带并校验 session `generation`；clear 原子递增 generation，旧 turn 在持久化消息、状态或 usage 前必须 `where: { id: sessionId, generation }` 通过。finished refresh 使用消息 ID 合并并同步更新 oldest cursor/hasMore，而非直接替换数组。

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm vitest run tests/unit/chat-persistence.test.ts tests/unit/chat-session-race.test.ts tests/unit/recovery-state.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add src/components/editor src/lib/ai/chat-persistence.ts src/app/api/ai/chat/route.ts tests/unit/chat-persistence.test.ts tests/unit/chat-session-race.test.ts
git commit -m "fix: preserve chat history across initialization and clear"
```

### 任务 3：让长文生成只在完整上下文下产生可应用提案

**文件：**

- 修改：`src/lib/ai/system-prompt.ts`
- 修改：`src/lib/ai/tools/registry.ts`
- 修改：`src/lib/ai/claude-agent-options.ts`
- 修改：`tests/unit/system-prompt.test.ts`
- 修改：`tests/unit/article-proposal-tool.test.ts`

- [ ] **步骤 1：编写失败的长文保护测试**

```ts
it("requires a range read before accepting a full proposal for a truncated article", async () => {
  const result = await proposeArticle({ markdown: "replacement" }, truncatedArticleContext);
  expect(result).toMatchObject({ ok: false, code: "article-context-incomplete" });
});

it("exposes read_current_article ranges for oversized articles", () => {
  expect(articleTools).toContainEqual(expect.objectContaining({ name: "read_current_article" }));
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm vitest run tests/unit/system-prompt.test.ts tests/unit/article-proposal-tool.test.ts`

预期：FAIL，当前仅注入前 12,000 字符且 proposal 可直接创建。

- [ ] **步骤 3：实现分段读取与完整性 invariant**

```ts
type ArticleContextState = {
  contentRevision: number;
  totalCharacters: number;
  initialRange: { start: number; end: number };
  readRanges: Array<{ start: number; end: number }>;
};

const readCurrentArticle = defineTool({
  name: "read_current_article",
  inputSchema: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }),
  execute: ({ start, end }) => readArticleRange(article, start, end),
});
```

Prompt 明确：所有首次生成和改写都创建提案；当 `articleContext.truncated` 时，必须先用 range tool 覆盖全文，否则 registry 拒绝 full Markdown proposal。同步删除“首次生成直接写入”的 prompt/UI 死分支。

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm vitest run tests/unit/system-prompt.test.ts tests/unit/article-proposal-tool.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add src/lib/ai/system-prompt.ts src/lib/ai/tools/registry.ts src/lib/ai/claude-agent-options.ts tests/unit/system-prompt.test.ts tests/unit/article-proposal-tool.test.ts
git commit -m "fix: preserve long article context before proposals"
```

### 任务 4：建立 chat turn lease，取消不可安全的整轮 retry

**文件：**

- 修改：`prisma/schema.prisma`
- 创建：`prisma/migrations/20260710010000_agent_turn_lease/migration.sql`
- 修改：`src/app/api/ai/chat/route.ts`
- 修改：`src/lib/ai/claude-agent-runtime.ts`
- 修改：`src/lib/ai/agent-config.ts`
- 修改：`src/lib/ai/claude-agent-options.ts`
- 修改：`tests/unit/agent-runtime-rate-limit.test.ts`
- 创建：`tests/unit/chat-turn-lease.test.ts`

- [ ] **步骤 1：编写失败的 lease 与 deadline 测试**

```ts
it("rejects a second active turn for the same session", async () => {
  await acquireTurnLease({ sessionId: "s1", turnId: "t1" });
  await expect(acquireTurnLease({ sessionId: "s1", turnId: "t2" })).rejects.toMatchObject({ status: 409 });
});

it("does not replay a tool-bearing turn after SDK rate-limit events", async () => {
  await expect(runClaudeAgentRuntime(inputWithToolEffect)).rejects.toMatchObject({ code: "rate-limited" });
  expect(query).toHaveBeenCalledTimes(1);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm vitest run tests/unit/agent-runtime-rate-limit.test.ts tests/unit/chat-turn-lease.test.ts`

预期：FAIL，当前可并行 running，runtime 会重建 query。

- [ ] **步骤 3：实现单轮 lease 和 SDK-native retry 策略**

```prisma
model AgentChatSession {
  // ...
  activeTurnId String?
  activeTurnExpiresAt DateTime?
  generation Int @default(0)
  @@index([activeTurnExpiresAt])
}
```

```ts
const lease = await prisma.agentChatSession.updateMany({
  where: { id: sessionId, OR: [{ activeTurnId: null }, { activeTurnExpiresAt: { lt: now } }] },
  data: { activeTurnId: turnId, activeTurnExpiresAt: deadline, claudeAgentSessionStatus: "running" },
});
if (lease.count !== 1) return conflictResponse();
```

删除 runtime 的 whole-turn loop，保留 SDK `api_retry` 事件展示。只允许持有 `activeTurnId` 的请求收口状态/消息；`maxSteps` 映射为 `maxTurns`，新增可配置但有上限的 `maxBudgetUsd` 与总 deadline。

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm vitest run tests/unit/agent-runtime-rate-limit.test.ts tests/unit/chat-turn-lease.test.ts tests/unit/agent-config.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add prisma src/app/api/ai/chat/route.ts src/lib/ai/claude-agent-runtime.ts src/lib/ai/agent-config.ts src/lib/ai/claude-agent-options.ts tests/unit/agent-runtime-rate-limit.test.ts tests/unit/chat-turn-lease.test.ts
git commit -m "fix: serialize agent turns and bound runtime execution"
```

### 任务 5：修正 SDK 终态、流归并和审批生命周期

**文件：**

- 修改：`src/lib/ai/agent-sdk-stream-adapter.ts`
- 修改：`src/lib/ai/claude-agent-runtime.ts`
- 修改：`src/lib/ai/claude-agent-options.ts`
- 修改：`src/app/api/ai/agent-approvals/[id]/status/route.ts`
- 修改：`src/app/api/ai/agent-approvals/batch/route.ts`
- 修改：`tests/unit/agent-sdk-stream-adapter.test.ts`
- 修改：`tests/unit/claude-agent-session.test.ts`
- 创建：`tests/unit/agent-approval-lifecycle.test.ts`

- [x] **步骤 1：编写失败的 runtime/adapter/approval 测试**

```ts
it("reports a timeout when the SDK ends without a result after abort", async () => {
  await expect(runClaudeAgentRuntime(abortedInput)).rejects.toMatchObject({ code: "timeout" });
});

it("emits a final complete assistant message after earlier delta text", () => {
  expect(flushedText).toContain("最终完整答复");
});

it("expires a pre-aborted pending approval instead of leaving its promise unresolved", async () => {
  await expect(canUseTool(preAbortedSignal)).resolves.toMatchObject({ behavior: "deny" });
});
```

- [x] **步骤 2：运行测试确认失败**

运行：`pnpm vitest run tests/unit/agent-sdk-stream-adapter.test.ts tests/unit/claude-agent-session.test.ts tests/unit/agent-approval-lifecycle.test.ts`

预期：FAIL，abort EOF 视为成功、mixed stream 丢文本、pre-aborted approval 留 pending。

- [x] **步骤 3：实现确定性终态和审批收口**

```ts
try {
  for await (const message of queryResult) adapter.consume(message);
} finally {
  adapter.flush({ terminal: abortSignal.aborted ? "aborted" : "ended" });
}
if (abortSignal.aborted) throw classifyAbortReason(abortSignal.reason);
if (!adapter.receivedResult) throw new AgentRuntimeError("missing-result");
```

Adapter 使用每个 assistant UUID 的文本状态，而不是全局 `streamedAnyText`；compaction begin/end 使用同一 source ID。审批先注册、再检查 signal，并以 `toolUseID/requestId` 原子决议；batch/status 清理过期 grant。短审批与 run deadline 对齐，超时显示“审批已过期，请重新发送”。

- [x] **步骤 4：运行测试确认通过**

运行：`pnpm vitest run tests/unit/agent-sdk-stream-adapter.test.ts tests/unit/claude-agent-session.test.ts tests/unit/agent-approval-lifecycle.test.ts`

预期：PASS。

- [x] **步骤 5：提交**

```bash
git add src/lib/ai/agent-sdk-stream-adapter.ts src/lib/ai/claude-agent-runtime.ts src/lib/ai/claude-agent-options.ts src/app/api/ai/agent-approvals tests/unit/agent-sdk-stream-adapter.test.ts tests/unit/claude-agent-session.test.ts tests/unit/agent-approval-lifecycle.test.ts
git commit -m "fix: close agent streams and approvals reliably"
```

### 任务 6：恢复语义、SessionStore 健康和运行指标

**文件：**

- 修改：`src/components/editor/WritingAssistant.tsx`
- 修改：`src/app/api/ai/chat/route.ts`
- 修改：`src/lib/ai/claude-agent-options.ts`
- 修改：`src/lib/ai/claude-session-store.ts`
- 修改：`src/lib/ai/agent-sdk-stream-adapter.ts`
- 修改：`src/lib/ai/agent-usage-ledger.ts`
- 修改：`tests/unit/claude-session-store.test.ts`
- 修改：`tests/unit/agent-runtime-usage.test.ts`

- [ ] **步骤 1：编写失败的恢复与可观测性测试**

```ts
it("forks from the selected assistant checkpoint when retrying an edited message", () => {
  expect(buildClaudeAgentOptions(input)).toMatchObject({ resumeSessionAt: "assistant-uuid", forkSession: true });
});

it("marks a mirrored session degraded and records SDK latency metadata", () => {
  expect(outcome).toMatchObject({ mirrorHealthy: false, ttftMs: 42, durationApiMs: 88 });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm vitest run tests/unit/claude-session-store.test.ts tests/unit/agent-runtime-usage.test.ts`

预期：FAIL，重试仍 resume 最新 transcript，mirror error 未影响健康状态，TTFT 被丢弃。

- [ ] **步骤 3：实现 checkpoint fork、degraded 状态和指标**

保存主 assistant 的 SDK UUID 到消息 metadata。编辑重试传 checkpoint，options 设置 `resumeSessionAt` 与 `forkSession: true`。adapter 将 `ttft_ms`、`duration_ms`、`duration_api_ms`、`num_turns`、`terminal_reason`、`mirrorHealthy` 写入 outcome；route 把它们持久化到 ledger metadata。mirror failure 将 session 标记 `degraded`，下次明确提示重新开始而不是声称可无损恢复。

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm vitest run tests/unit/claude-session-store.test.ts tests/unit/agent-runtime-usage.test.ts tests/unit/agent-usage-ledger.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add src/components/editor/WritingAssistant.tsx src/app/api/ai/chat/route.ts src/lib/ai/claude-agent-options.ts src/lib/ai/claude-session-store.ts src/lib/ai/agent-sdk-stream-adapter.ts src/lib/ai/agent-usage-ledger.ts tests/unit/claude-session-store.test.ts tests/unit/agent-runtime-usage.test.ts
git commit -m "feat: make agent recovery and telemetry explicit"
```

### 任务 7：性能收敛、SDK 升级与全量验证

**文件：**

- 修改：`src/lib/ai/claude-agent-options.ts`
- 修改：`src/lib/ai/tools/registry.ts`
- 修改：`package.json`
- 修改：`pnpm-lock.yaml`
- 创建：`tests/unit/agent-sdk-contract.test.ts`

- [ ] **步骤 1：编写失败的能力裁剪与 SDK fixture 测试**

```ts
it("does not expose code or web tools when the target has no corresponding capability", () => {
  expect(buildClaudeAgentOptions(articleOnly).tools).not.toContain("web_fetch");
});

it.each([sdk0195Result, sdk0205Result])("normalizes SDK result terminal metadata", (message) => {
  expect(adapter.consume(message).terminalReason).toBeDefined();
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm vitest run tests/unit/agent-sdk-contract.test.ts`

预期：FAIL，当前一律暴露工具且无新版本 fixture。

- [ ] **步骤 3：实现能力裁剪并升级 SDK**

将 model/config/skills/web-research 的独立读取并行化；按 article、code-source、web-research capability 生成工具列表和子 Agent。将 SDK 升到 `0.3.205`，仅在 fixture 测试通过后消费 `terminal_reason`、background task 等新增字段；保留未知事件计数而非静默丢弃。

- [ ] **步骤 4：运行测试与质量门禁**

运行：

```bash
pnpm vitest run tests/unit/agent-sdk-contract.test.ts
pnpm typecheck
pnpm lint
pnpm test
```

预期：所有命令退出码 0。

- [ ] **步骤 5：提交**

```bash
git add src/lib/ai/claude-agent-options.ts src/lib/ai/tools/registry.ts package.json pnpm-lock.yaml tests/unit/agent-sdk-contract.test.ts
git commit -m "perf: narrow agent capabilities and update sdk"
```

## 计划自检

- P0 数据丢失路径由任务 1–3 覆盖；P1 runtime、并发、审批与恢复由任务 4–6 覆盖；性能和 SDK 兼容由任务 7 覆盖。
- 每个行为变更都先有失败测试、再有最小实现、再运行关联测试。
- 未新增页面或组件库依赖；编辑器改动限定在现有 `WritingAssistant` 与 `EditorWorkspace`。
