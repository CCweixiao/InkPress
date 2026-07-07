# 写作 Agent 对话区 & 对话框 交互重构设计

> 范围：文章生成页左侧 AI 对话区（agent 工作过程可视化）+ 底部对话框（composer）。
> 目标：清晰优雅地展示 agent 工作核心环节、可见 I/O 与异常、保证环节顺序性、正确的授权拦截与级联终止、支持大任务计划拆分（plan 模式）。
> 参考范式：OpenAI Codex CLI、Cursor Agent、Claude Code。

---

## 决策快照（已确认 · 2026-06-23）

| 决策项 | 结论 | 出处 |
|--------|------|------|
| 当前阶段 | **先评审本文档，暂不写代码**；待你反馈后再进入 P1 | §5 |
| 授权级联架构 | **A+：服务端权威 checkpoint + AgentScope 式权限引擎**（ALLOW/DENY/ASK 决策 + suggestedRule 学习环；resume 复用首轮 routing，确定性；客户端薄壳）。原「客户端回合状态机」已弃用——状态权威须在服务端 | §2.5 |
| 内联模型选择器 | **单 chip + popover**（框内「✦ 模型名 ▾」，弹出按 provider 分组，保留 provider×model 语义） | §3.2 |

> 下文凡标「推荐」且与上表一致的，即按上表执行。

---

## 0. 背景与现状盘点

### 已具备（不要重造）
| 能力 | 现位置 | 说明 |
|------|--------|------|
| 思考过程 | `components/ai/ReasoningBlock.tsx` | Codex 风格，流式自动展开、收起态虚化预览，已较成熟 |
| 工具调用 | `components/ai/ToolCallBlock.tsx` | 图标+中文名+状态+摘要，展开看 input/output/error |
| 意图/项目/技能步骤 | `components/ai/AgentStepBlock.tsx` | 折叠块，running/completed/failed 三态 |
| 代码源授权 | `WritingAssistant.tsx` `CodeSourceApprovalCard` | 仅本会话/长期信任/拒绝 三态 |
| 文章提案 diff | `WritingAssistant.tsx` `ProposalCard` + `ArticleDiffDialog` | 卡片内折叠预览 + 全屏审查 + 快捷键（已重构） |
| token 统计后端 | `route.ts` `onFinishUsage` + `data-context-usage` SSE | 已持久化 input/output/reasoning/total + 估算上下文 |
| 意图路由 | `lib/ai/agent-orchestrator.ts` | 已声明式重构（INTENT_RULES）+ LLM 优先 |

### 主要缺口（本次要补）
1. **环节顺序性弱**：`message.parts.map` 是一条 ~250 行的 `if/else` 链，按 part 到达顺序平铺渲染，无阶段语义、无分组，思考/工具/证据/产出混在一起，用户难以建立"agent 现在在第几步"的心智模型。
2. **授权拦截无级联**：当前每轮 SSE 只能在**首个**授权点 early-return（`route.ts:507`），即"一轮一闸"。拒绝后该轮静默结束，没有显式的"下游环节终止"反馈，也不支持一轮内多个授权点（如 计划→工具→提案 三连闸）。
3. **无 plan 模式**：有 `set_task_plan` 工具但只是个普通 tool call，没有"先出计划→用户审批→再执行"的闭环。
4. **模型选择器外置**：`AIPanel.tsx` 顶部双列下拉（provider × model），与对话框割裂，不符合 Codex/Cursor"选择器在输入框里"的范式。
5. **停止按钮不醒目**：仅 `h-7 w-7` ghost 图标，与发送按钮同尺寸同位置切换，紧急感不足。
6. **token 不可见**：后端已有数据，前端只在消息流里渲染一行小字（`data-context-usage`），对话框无入口，看不到会话累计消耗。

---

## 1. 设计原则

1. **阶段化（Stage-first）**：用有限的、有序的阶段模型组织所有 part，用户先看到"在哪一步"，再决定是否展开细节。
2. **渐进披露（Progressive disclosure）**：默认收起细节（思考全文、工具 I/O、证据），点击展开；收起态给一行高信噪比摘要。
3. **I/O 对称可见**：每个工具/阶段都可看到"输入了什么、输出了什么、耗时多少 token"。
4. **失败可定位**：异常归类成中文短句（复用后端 `classifyRouteError` 思路）+ 原始错误可展开，不裸露英文堆栈。
5. **闸门显式且可级联**：授权/计划审批是"阻塞闸"，拒绝要明确终止并说明影响范围。
6. **声明式注册表**：part 渲染走注册表（`PART_RENDERERS`），新增 part 类型只加一条，与后端 INTENT_RULES 理念一致。

---

## 2. Agent 工作过程可视化（左侧对话区）

### 2.1 统一阶段模型（canonical pipeline）

把一轮 agent 回合的 part 归到 8 个有序阶段。阶段是渲染分组语义，不要求 part 严格按阶段顺序到达（流式可能交错），渲染层负责按阶段重排分组。

```
① 意图      data-agent-step(intent)            「识别任务意图」
② 就绪      data-code-source-approval          授权闸（可阻塞）
            data-code-source-ready / data-git-range
③ 计划      set_task_plan 工具 → PlanCard      计划闸（plan 模式可阻塞）
④ 思考      reasoning                          （贯穿，按消息内位置）
⑤ 工具      tool-* / dynamic-tool              skill 加载/联网/项目探索/Git 分析/素材
⑥ 证据      data-commit-evidence / data-change-evidence-summary /
            data-code-explore-step / data-project-snapshot / data-source-evidence / source-url
⑦ 产出      propose_*_revision → ProposalCard / direct 写入 / set_article_digest
⑧ 异常      error / output-error / 闸门拒绝
```

> ④思考 在 Codex/Claude Code 里是穿插在工具之间的，不强制归到固定槽位；保留 part 原序渲染，但视觉上用统一"思考"样式。

### 2.2 声明式 part 渲染注册表（替换 if/else 链）

当前 `WritingAssistant.tsx:809-1084` 的巨型 `if/else` 抽成注册表：

```ts
type PartRenderer = {
  stage: Stage;                          // 归属阶段，用于分组
  match: (p: Part) => boolean;           // 是否命中
  render: (p: Part, ctx: RenderCtx) => ReactNode;
  density?: "inline" | "block";          // 内联（证据/url）还是块级
};

const PART_RENDERERS: PartRenderer[] = [
  { stage: "reasoning", match: p => p.type === "reasoning",
    render: (p) => <ReasoningBlock text={p.text} state={p.state} /> },
  { stage: "ready",    match: p => p.type === "data-code-source-approval",
    render: (p, ctx) => <ApprovalGate kind="code-source" data={p.data} onDecide={ctx.onApprove} /> },
  { stage: "tool",     match: p => isToolPart(p),
    render: (p) => <ToolCallBlock part={p} /> },
  { stage: "evidence", match: p => p.type?.startsWith("data-") && EVIDENCE_TYPES.has(p.type),
    render: (p) => <EvidenceChip data={p.data} />, density: "inline" },
  // … 其余 stage
];
```

收益：① 新增 part 只加一条；② 每条自带 `stage`，渲染层据此分组、保证环节顺序；③ 可对每个 stage 做统一的收起/展开、计数徽标。

### 2.3 各组件升级

**① 意图条（IntentBar）** — 把当前的 intent step 提升为顶部一条"任务卡片"：
```
┌─────────────────────────────────────────┐
│ ◎ 创作文章  · 公众号                    │   ← 意图图标 + 中文标签（复用 INTENT_LABEL）
│   将围绕「支付系统架构」创作，需联网+素材 │   ← rationale
│   [3 步计划] [2 个 Skill] [联网] [素材]   │   ← 能力徽标（needs* 可视化）
└─────────────────────────────────────────┘
```

**③ 计划卡（PlanCard）** — `set_task_plan` 工具输出升级为专属卡片（不再是普通 ToolCallBlock）：
```
┌─ 📋 执行计划（3 步）────────  待确认 ─┐
│ 1. 联网调研支付系统主流架构            │   ✓ 可逐条勾选/排除
│ 2. 读取本项目相关模块佐证              │
│ 3. 撰写公众号文章（含 2 处插图）        │
│ ─────────────────────────────────────  │
│ 预估 ~12k tokens · 约 4 次工具调用      │
│              [ 调整计划 ] [ ✓ 开始执行 ]│   ← plan 模式下的审批闸
└────────────────────────────────────────┘
```

**⑤ 工具调用** — 保留 `ToolCallBlock`，增强：
- 顶部加**耗时**与**token 增量**（来自 `onFinishUsage` 差分）。
- skill 加载（`load_skill`/`read_skill_resource`）单独样式：✨ 紫色"已加载 Skill：xxx"，点开看 manual 摘要（现在是塞在 JSON 输出里）。
- 工具失败（`output-error`）右侧直接给"重试/换方案"按钮（呼应 system prompt 第 7 条"工具失败最多重试一次"）。

**⑥ 证据** — 当前 6 种证据 part 各自一个边框块，零散。统一成 `EvidenceChip`（内联紧凑）+ 可"汇总展开"：
```
🔍 证据 · 3 个提交 · 12 文件 · 4 组变化   [展开]   ← 收起态一行
```

**⑦ 产出** — `ProposalCard` 已较好；补：direct 模式（首次直写）目前 `return null` 静默写入，改为一条轻量"✓ 已写入正文（首次生成）"提示条，让用户知道发生了什么。

**⑧ 异常** — 见 2.7。

### 2.4 顺序性保证

- **渲染层分组**：`PART_RENDERERS` 的 `stage` 字段 + 一个 `STAGE_ORDER` 常量，渲染时按阶段顺序分组；同阶段内保留 part 原序。
- **同阶段并发**：工具调用可能并发（多个 tool part 同时 streaming），同 stage 内按"开始时间"稳定排序，避免跳动。
- **流式插入**：新 part 到达时插入到其 stage 分组末尾，不重排已完成项（已完成项位置固定，符合用户预期）。
- **跨消息**：每个 user/assistant message 独立分组；阶段分组只在单条 assistant message 内做。

### 2.5 权限系统（Permission System）+ 闸门机制 ⭐

> 采纳 [AgentScope 权限系统](https://java.agentscope.io/v2/zh/docs/building-blocks/permission-system.html) 的决策模型，结合 InkPress 现状做适配（不照搬 Java 实现）。传输层用 §决策快照确认的 **A+（服务端权威 checkpoint）**。

#### 2.5.1 先厘清两种「确认」——不要混淆

| | 产出物取舍（**非闸门**） | 循环内授权（**闸门**） |
|---|---|---|
| 时机 | agent 内循环**已结束**后 | 工具**执行前**，循环内 |
| 对象 | `ProposalCard` 应用/放弃 | 危险/敏感工具调用 |
| 影响 | 应用=回显编辑区，放弃=不回显，**不影响循环** | 不授权则该工具不执行，循环可能中止 |
| 归属 | UX 产物取用 | **权限系统** |

`ProposalCard` 保持现状，**不纳入权限系统**。本节只讲循环内闸门。

#### 2.5.2 决策引擎：ALLOW / DENY / ASK 三态

每次工具调用过 `evaluatePermission(tool, input, ctx)`，三组件按优先级合议（借鉴 AgentScope 的 Rules + Mode + Built-in Checks）：

1. **Built-in Checks（不可绕过）** — 每个 tool 实现自己的运行时检查，按**真实入参**判定：
   - InkPress 已有：`validateLocalCodeSource` 拒绝 `~` / `.ssh` / `.aws` / 系统目录 = 危险路径强制 DENY。
   - 扩展点：未来 `commit`/`push`/读授权目录外路径等 tool 各自实现 `checkPermissions(input)`，可返回 `ALLOW/DENY/ASK/PASSTHROUGH`（PASSTHROUGH=交给引擎）。
2. **Rules（最高优先级，可增删）** — `{ tool, ruleContent(匹配模式), behavior: ALLOW|DENY|ASK, source }`：
   - `source`：`userSettings`（长期）/ `projectSettings` / `session`（本会话）/ `suggested`（ASK 时自动生成、用户接受后落库）。
   - 评估：用 tool 的 `matchRule(ruleContent, input)` 判定是否命中；`ruleContent=null` 匹配该 tool 全部调用。
3. **Mode（命不中规则时的兜底）** — InkPress 三档：
   | Mode | 行为 | 适用 |
   |------|------|------|
   | `readonly`（默认） | 放行只读/提案类，写/危险类 DENY | 当前所有工具都是只读/提案，**默认零打扰** |
   | `propose` | 自动读+提案，写操作 ASK | 启用未来 git/publish 工具后 |
   | `autonomous` | 全放行，但 DENY 规则 + 危险路径仍拦 | 用户明确授予较大权限 |

> **deny 规则 + 危险路径永远不可绕过**（即便 `autonomous` 模式）。`eval`/headless 场景用 `DONT_ASK`（ASK→DENY）。

#### 2.5.3 扩展性 = suggested-rule 学习环（你说的「灵活加新删旧」）

**加新闸门零改代码**：每次 ASK，引擎按本次调用自动生成 `suggestedRule`（如「以后对 `explore_project` 路径 `/Users/x/Y` 总是允许」）。用户在闸门上勾选接受（选 scope：本会话 / 长期）→ 落库为规则 → 将来相同调用自动 ALLOW，不再问。
**删旧**：规则管理 UI（设置页列出所有 `userSettings`/`session` 规则，可删除）。

代码层是**声明式注册表**（呼应 [声明式注册表优于硬编码]）：`PERMISSION_RULES[]` + 每 tool 的 `matchRule/checkPermissions`，加 tool/加规则只改数据不改分发逻辑。

#### 2.5.4 传输层 = A+（服务端权威 checkpoint，确定性 resume）

修正原「客户端回合状态机」的洞（状态权威放服务端，客户端退化为薄壳）：

```
tool 调用 → evaluatePermission
  ├─ ALLOW            → 执行
  ├─ DENY             → 工具返回 permission-denied（模型在【同一次循环】内看到，自行中止/换方案，与 Claude Code 一致）
  └─ ASK              → 服务端写 checkpoint 到 AgentChatSession {routing, 已执行步, pendingPlan, suggestedRule}
                       → 发 data-permission-ask → 薄客户端渲染 PermissionGate
                       → 用户 POST 决策 {allow|deny, acceptSuggestedRule?, scope?}
                       → 服务端读 checkpoint 确定性 resume（复用首轮 routing，不再调 LLM 重新路由）
```

- **确定性**：resume 复用首轮持久化的 `{intent, needs, projectId, skillIds}`，不重新 `routeAgentRequest` → 不会出现「第一轮批准了探索项目、resume 时又被判不需要」的漂移。
- **可恢复**：刷新/断线后客户端从 session 拉取 pending gate 续上。
- **拒绝的语义**（软化原「级联终止」）：deny ≠ 客户端硬终止整轮，而是该工具被拒、模型在同一次循环决定后续（通常自然中止或换方案）。仅当工具标记为 `critical`（如发布、 irreversible 写）时，deny 才触发回合 `abort` + 发 `data-turn-aborted(reason, cancelledSteps)`。这比客户端级联更简单也更正确。

#### 2.5.5 PermissionGate 组件

```
┌─ ⏸ 需要授权 ─ 探索代码项目 ────── 待处理 ┐
│ 📁 /Users/x/aiwaji                       │
│ 仅读取源码/符号/Git 历史，不修改不执行     │
│ ──────────────────────────────────────── │
│ ☑ 以后对此项目自动允许（建议规则）         │  ← suggestedRule，勾选+选 scope
│   ( ) 仅本次  (•) 本会话  ( ) 长期信任     │
│ ──────────────────────────────────────── │
│   [ ✕ 拒绝 ]              [ ✓ 允许 ]      │  ← 拒绝在左低强调，允许在右高强调
└──────────────────────────────────────────┘
```
若该工具 `critical`，拒绝区补明示「拒绝将终止本轮任务」。

#### 2.5.6 InkPress 现状映射：现有 code-source approval 就是这套系统的种子

| AgentScope 概念 | InkPress 现状 | 本设计 |
|-----------------|---------------|--------|
| 危险路径 built-in check | `validateLocalCodeSource` 拒 home/.ssh/系统目录 | 保留，归为不可绕过 DENY |
| `session` ALLOW 规则 | "仅本会话允许" | 存 `AgentChatSession` |
| `userSettings` ALLOW 规则 | "长期信任" = `CodeSourceGrant` | 复用 CodeSourceGrant 模式 |
| 对 `explore_project` 的 ASK | 首次读新路径要问 | 泛化为权限引擎的 ASK |
| suggested 规则 | 无（每次新路径都问） | **新增**：接受即落库，免重复问 |

> 当前所有内循环工具都是只读/提案类 → `readonly` 模式下**唯一会 ASK 的就是读新代码源**（即现有 approval）。**权限系统主要是把现有 code-source approval 泛化、并为未来 git/publish 工具铺路**，不是从零造。

### 2.6 Plan 模式

借鉴 Claude Code / Cursor 的 plan mode：

- **入口**：对话框左下加"计划模式"开关（见 §3.2 composer）。开启后，首轮 agent 只到"③ 计划"阶段就停在 `PlanCard`，不执行后续工具。
- **审批**：用户可逐条勾选/编辑步骤（删除某步、追加要求），点"开始执行"后 agent 按确认后的计划跑。
- **机制归属**：plan 审批本质是**权限系统对 `set_task_plan` 的 ASK**（plan 模式 = 给该 tool 配一条 ASK 规则）——复用 §2.5 的 checkpoint/resume 传输，不另造闸门。
- **执行中再闸**：计划执行期间的危险工具授权走同一套 `PermissionGate`（§2.5.5）。
- **数据契约**：`set_task_plan` 输出已是 `{ intent, steps[] }`；前端把它从普通 tool call 提升为 `PlanCard`。

### 2.7 异常报错呈现

- **归类**：前端复用后端 `classifyRouteError` 的同一份映射（抽到 `lib/ai/error-classify.ts` 共享），把 `error.message` 归类成中文短句 + 修复建议：
  | 归类 | 文案 | 建议 |
  |------|------|------|
  | 余额/配额 | 模型余额不足或额度已尽 | 检查供应商账户或换模型 |
  | Key 失效 | API Key 无效或已过期 | 系统配置里更新 Key |
  | 超时 | 请求超时 | 重试或换更快的模型 |
  | 限流 | 请求被限流 | 稍后重试 |
  | 不支持结构化输出 | 所选模型不支持结构化输出 | 换支持 tool/function 的模型 |
- **展示**：异常块高亮红色 + 中文短句 + 「展开原始错误」+ 「重试」按钮；工具级错误（`output-error`）就地红框 + 重试，不整轮标红。

---

## 3. 对话框（composer）美化

当前结构（`WritingAssistant.tsx:1131-1170`）：圆角框 + textarea + 底栏（左：快捷键提示，右：发送/停止图标按钮）。

### 3.1 停止按钮更显眼

- 停止态：按钮变**红色实心胶囊**带"⏹ 停止生成"文字（不再是无文字小图标），尺寸加大（`h-8 px-3`），可加呼吸/脉冲边框传递"正在跑、可中断"。
- 位置：仍居右，但 idle 态发送按钮与 busy 态停止按钮**视觉权重明显区分**（一灰一红）。
- 行为：提供"软停"（完成当前工具后停）与"硬停"（立即 abort）—— 默认软停，长按/二次点击硬停（参考 Codex 的 esc 行为）。

### 3.2 内联模型选择器（移入对话框）

去掉 `AIPanel.tsx` 顶部的双列下拉，把选择器放进 composer **底栏左侧**（Codex/Cursor 范式）：

```
┌──────────────────────────────────────────────┐
│  让 Agent 研究、创作或调整文章…              │   ← textarea
│                                              │
│ ┌────────┐                      ┌─────────┐  │
│ │✦ GPT-5 │  📋计划  🌐联网  ⏱ 12k│  发送 ▶ │  │   ← 底栏：模型 + 能力开关 + token + 发送
│ └────────┘                      └─────────┘  │
└──────────────────────────────────────────────┘
```

- **模型选择器**：单个 chip（`✦ 模型名 ▾`），点击弹出 popover，**按 provider 分组**列出所有模型，默认模型打标。这样既保留 provider×model 语义（后端要 providerId+modelId），又收敛成一个入口。
  - 选中态显示"模型友好名"（如 `GPT-5` 而非 `gpt-5-2025`）；popover 里每个模型可挂"快/思考/便宜"标签（参考 Claude selector 给描述）。
- **能力开关（可选二期）**：联网、计划模式、素材 自动插入 作为 composer 上的 toggle chip，覆盖/微调意图路由的 `needs*`（当前只能靠 agent 自动判）。
- **数据流**：`providerId/modelId` 状态从 `AIPanel` 下沉到 `WritingAssistant`（或共用一个 `useModelSelection` hook），composer 内消费。

### 3.3 token 统计图标 + 消耗面板 ⭐

后端已有全部数据（`onFinishUsage` 的 input/output/reasoning/total + `data-context-usage` 的 estimated/budget），前端只需聚合 + 入口。

**底栏 token chip**（右下、发送按钮左侧）：
```
⏱ 12.3k / 32k   ← 点击展开；颜色随占用率变（<60% 灰 / 60-85% 琥珀 / >85% 红）
```
- 数字 = 当前会话累计 input+output tokens（聚合本会话所有 `turnUsage`）；分母 = `contextBudgetTokens`（或模型上下文窗口）。
- 占用率即上下文窗口健康度，>85% 时 chip 闪琥珀并提示"接近上下文上限，建议新开会话或压缩历史"（后端已有 `compressed` 压缩能力）。

**点击展开 Popover 面板**：
```
┌─ 上下文与消耗 ──────────────────────┐
│  窗口占用   ████████░░░░  62%        │
│  本会话累计 12,340 / 32,000 tokens   │
│ ─────────────────────────────────── │
│  本轮  输入 4,210  输出 980  思考 1,2k│
│  累计  输入 9,800  输出 2,540 思考 4k │
│  历史已压缩 1 次                     │
│  模型 GPT-5 (200k 窗口)              │
└─────────────────────────────────────┘
```
- 数据来源：每轮 `onFinishUsage` 写入会话级累计（前端用 ref/state 累加，或读 `AgentChatSession` 持久化字段 `lastInputTokens` 等汇总）。
- "本轮/累计/压缩次数/模型窗口"四块信息覆盖用户最关心的"还剩多少上下文、花了多少"。

---

## 4. 数据契约变更（SSE / API）

| 新增/变更 | 类型 | 用途 |
|-----------|------|------|
| `data-permission-ask` | SSE part | 权限引擎返回 ASK：`{ tool, inputPreview, risk, suggestedRule, critical, pendingPlan }`，前端渲染 `PermissionGate` |
| 决策回传 | POST body | `{ decision: allow\|deny, acceptSuggestedRule?: bool, scope?: session\|userSettings }`，配合 checkpoint resume |
| checkpoint 字段 | `AgentChatSession` 扩展 | 持久化 `{routing, executedSteps[], pendingPlan[]}`，支撑确定性 resume + 刷新恢复 |
| `data-turn-aborted` | SSE part | `critical` 工具被拒后下发：`{ reason, cancelledSteps[] }` |
| `data-tool-usage` | SSE part | 单工具 token 增量 + 耗时（`onFinishUsage` 差分），驱动 §2.3 工具块 |
| `data-context-usage`（已存在） | SSE part | 不变，composer token chip 复用 |
| `mode` / `forceNeeds` | 请求 body | 会话级权限 mode（readonly/propose/autonomous）+ 可选能力覆盖（联网/计划/素材） |
| composer 模型 | 请求 body | `providerId/modelId` 下沉到 composer（§3.2） |

> 权限规则存储：`session` 规则进 `AgentChatSession`；长期规则复用 `CodeSourceGrant` 表模式（或新增 `PermissionRule` 表）。后端 `onFinishUsage` 已有全量 token 回调，token 数据零额外成本。

---

## 5. 实施分期（建议）

| 期 | 内容 | 依赖 | 风险 |
|----|------|------|------|
| **P1 对话框** | §3.1 停止按钮、§3.2 内联模型选择器（状态下沉）、§3.3 token chip+面板 | 仅前端 + 复用已有 token 数据 | 低，纯 UI，先出可见成果 |
| **P2 渲染重构** | §2.2 part 注册表 + §2.1 阶段分组 + §2.3 各块升级（IntentBar/EvidenceChip/direct提示） | 纯前端重构 | 中，需保证不破坏现有 part 渲染；配单测 |
| **P3 异常呈现** | §2.7 抽 `error-classify.ts` 共享 + 异常块 + 重试 | 前端 + 小量后端 | 低 |
| **P4 权限引擎（A+）** | §2.5.2 决策引擎（Rules+Mode+Built-in）+ §2.5.4 checkpoint/resume + 把现有 code-source approval 接入 + suggestedRule 落库 + `PermissionGate` | route.ts + writing-agent + AgentChatSession 扩展 | 高，确定性 resume 是核心；先只接现有 code-source 这一种 ASK，验证闭环 |
| **P5 PlanCard + plan 模式** | §2.3 计划卡 + §2.6（`set_task_plan` 作为权限 ASK 的特例） | 复用 P4 引擎 | 中 |
| **P6 新危险工具接入** | 未来 git/publish/读目录外等 tool 实现 `checkPermissions` + 配规则 | P4 引擎就绪后按需 | 中，逐 tool 评估风险分级 |

P1/P2/P3 可并行且互不依赖；P4 是权限闭环基础；P5/P6 依赖 P4。当前 `readonly` 默认模式下，P4 落地后唯一行为变化是 code-source approval 升级为带 suggestedRule 的 `PermissionGate`（可"长期免问"）。

---

## 6. 参考来源

- [Codex CLI — OpenAI Developers](https://developers.openai.com/codex/cli) · [Codex CLI 0.131 TUI 升级](https://www.zeniteq.com/openai-codex-cli-0-131-0-brings-a-smarter-tui-and-codex-doctor-yivwpl) · [Codex UX issue #2609](https://github.com/openai/codex/issues/2609)
- [CLI 编码 agent DX 对比（OpenCode/Codex/Claude Code）](https://gordonbeeming.com/nuggets/cli-tools-comparison)
- [Model management UX — ShapeofAI](https://www.shapeof.ai/patterns/model-management) · [Gemini 模式选择 case study](https://www.aiuxplayground.com/gallery/gemini-model-selection/) · [AI chat 界面设计 anatomy — Setproduct](https://www.setproduct.com/blog/ai-chat-interface-ui-design)
- [Token Usage Indicator 模式](https://www.aiuxplayground.com/pattern/token-usage-indicator/) · [Warp 上下文用量条 #8795](https://github.com/warpdotdev/warp/issues/8795) · [Cursor 实时上下文请求](https://forum.cursor.com/t/provide-a-realtime-insight-into-context-window-and-token-usage/78289) · [Claude Code 状态栏上下文监控](https://pasqualepillitteri.it/en/news/162/claude-code-status-bar-context-monitor-guide)
- [Human-in-the-Loop 审批工作流 — StackAI](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation) · [LangGraph 审批门 — ML Mastery](https://machinelearningmastery.com/building-a-human-in-the-loop-approval-gate-for-autonomous-agents/) · [Temporal 持久化 HITL](https://learn.temporal.io/tutorials/ai/building-durable-ai-applications/human-in-the-loop/)
- **[AgentScope 权限系统（Permission System）](https://java.agentscope.io/v2/zh/docs/building-blocks/permission-system.html)** — ALLOW/DENY/ASK 三态决策、Rules+Mode+Built-in Checks 三组件、suggested-rule 学习环、不可绕过的危险路径保护。§2.5 主要借鉴对象。
