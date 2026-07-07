# 素材块 P1：AI @引用 + ChatComposer 提取 + P0 打磨

- **日期**：2026-07-07
- **范围**：P1（AI @引用）为主线 + 把 `WritingAssistant` 的输入表面提取为独立 `ChatComposer` 组件 + 顺带修现有 `/snippets` 页面的明显 UX 短板
- **TDD 边界**：仅纯逻辑层（vitest + `tests/unit/`，不引入 RTL / 不写 API route 测试 / 不写 e2e）
- **chip 架构**：Tray 托盘模式（refs 作为可删 chip 出现在输入框下方，textarea 保持纯文本）
- **上游设计文档**：`docs/features/snippets-design.md`（P0–P4 全景，本 spec 只做 P1 + P0 打磨）

---

## 1. 目标与非目标

### 目标
1. **打通「灵感素材 → AI 写作」主线**：对话框输入 `@` 触发素材检索面板 → 键盘/鼠标选中 → chip 进托盘 → 发送时序列化为 `{{snippet:id}}` → agent 调 `load_snippets` 工具加载 → system prompt 注入融入规则 → 生成文章时自然融入。
2. **提取 `ChatComposer` 组件**：把 `WritingAssistant`（2597 行）里散在顶层的输入相关 state / 逻辑 / JSX 收拢为独立组件，为未来输入元素（P2 拖拽面板、P3 快捷弹窗、附件等）建立可扩展的家。
3. **P0 打磨**：修现有 `/snippets` 页面的 4 个明显 UX 短板。

### 非目标（本轮不做，留后续 spec）
- **P2**：编辑器侧边栏 `SnippetInsertPanel` / 拖拽插入编辑区 / 从编辑器摘录 / 标签颜色系统
- **P3**：原地编辑 / 全局快捷键弹窗（`Cmd+Shift+N`）/ 全局搜索整合 / AI 自动生成 title+aiSummary / embedding 语义向量
- **P4**：标签独立表 / 批量操作 / 导出 / 移动端响应式 / 链接 OG 抓取
- **全量 cursor 分页 / 多标签 AND 组合筛选**（属 P2/P3 体量）
- **ChatComposer 的单元测试**（本轮仅纯逻辑层 TDD；ChatComposer 靠手动验证清单）

---

## 2. 背景与现状

### 2.1 已落地的 P0 MVP
- Prisma 模型 `Snippet` + `SnippetUsage`（`prisma/schema.prisma`）+ migration `20260709000000_snippets`
- API：`/api/snippets`（GET 列表 + POST 创建）、`/api/snippets/[id]`（PATCH/DELETE）、`[id]/pin`、`[id]/usage`、`/api/snippets/load`、`/api/snippets/search`、`/api/snippets/tags`
- UI：`SnippetsView` / `SnippetCard` / `SnippetCreateBar` / `SnippetList` / `SnippetTagSidebar` / `types`
- 顶栏导航入口（`src/app/page.tsx`）

### 2.2 WritingAssistant.tsx 现状（2597 行）
- `ChatTextarea`（L1546-1571）：薄 memo textarea，父级用 ref 桥接 `onKeyDown` 保持引用稳定，避免流式 chunk 重渲染传到输入框。
- 输入相关 state 散在顶层：`input`/`inputHistory`/`historyIndex`（L1611-1619）、斜杠全套 `slashIndex`/`slashForcedClosed`/`slashQ`/`slashFiltered`/`slashOpen`/`slashNotice`（L1657-1673）、`handleInputChange`（L1911）、`chatKeydownRef`/`stableChatKeydown`（L1919-2128）、`sendText`/`submit`（L1955+）。
- 输入区 JSX（L2505-2555+）：`SlashMenu` + slashNotice + approval 通知 + `ChatTextarea` + 底栏（`ModelSelector`/`TokenMeter`/发送停止按钮）。

### 2.3 关键集成点（已 Explore 确认）
| 集成点 | 位置 | 复用方式 |
|---|---|---|
| slash-commands 分层 | `src/components/editor/slash-commands.tsx`（148 行） | 纯函数 `slashQuery`/`filterSlashCommands`/`parseSlashCommand` + `SlashMenu` 展示组件 → `@` 平行复刻成 `at-commands.ts` |
| AI 工具注册 | `src/lib/ai/tools/registry.ts`（949 行，单一事实源） | `InkPressToolDefinition` 模式，照抄 `articleAssetsTool`（L350-387）；execute 内直接 `import { prisma } from "@/lib/db"` |
| system prompt | `src/lib/ai/system-prompt.ts` `buildInkPressSystemPrompt`（L59-182） | 数组 `.join("\n")` 拼装，条件 section 范本（`codeSection` L106-122）；调用方 `claude-agent-options.ts` L291-297 |
| @面板检索端点 | `src/app/api/snippets/search/route.ts` | 已为 @面板预留：返回精简字段 `id/title/summary/kind/tags/imageUrl/color/updatedAt`，按 `usageCount desc` 排序，前端直接 fetch |
| 测试基建 | `vitest.config.ts`（env=node，`testMatch: tests/unit/**/*.test.ts`，`@` alias→`src`） | mock prisma 模式成熟；无 API route 测试、无 msw、无 RTL |
| 全局快捷键 | 无统一系统 | textarea 内触发只需在 keydown handler 加分支，本轮不引入全局快捷键库 |

---

## 3. 架构总览

严格分层：**纯逻辑层（TDD 红绿）/ 组件层（typecheck + build + 手动验证）/ 数据层（已有，本轮不动）**。

### 3.1 纯逻辑层（TDD）
```
src/components/editor/at-commands.ts        ← 新：@检测/过滤/解析纯函数（平行 slash-commands.tsx 数据层）
src/lib/ai/snippet-serialize.ts             ← 新：ComposerState → { message, snippetRefs } 序列化
src/lib/ai/tools/registry.ts                ← 改：注册 load_snippets 工具
src/lib/ai/system-prompt.ts                 ← 改：InkPressSystemPromptInput 加 snippetsHint，条件 section
tests/unit/at-commands.test.ts              ← 新
tests/unit/snippet-serialize.test.ts        ← 新
tests/unit/load-snippets.test.ts            ← 新
tests/unit/system-prompt.test.ts            ← 扩展（已有文件）
```

### 3.2 组件层（无单测）
```
src/components/editor/ChatComposer.tsx          ← 新：输入表面（斜杠 behavior-preserving 搬入 + @ + 托盘 + IME）
src/components/editor/SnippetMentionPopover.tsx  ← 新：浮动检索面板（镜像 SlashMenu）
src/components/editor/SnippetRefChip.tsx         ← 新：托盘里的可删 chip
src/components/editor/WritingAssistant.tsx       ← 改：抽出输入表面，瘦身约 300 行
src/components/snippets/SnippetCard.tsx          ← 改：多 tag + 键盘可达 + 删除确认
src/components/snippets/SnippetsView.tsx         ← 改：搜索框接 /api/snippets?q=
```

---

## 4. ChatComposer 提取

### 4.1 提取边界

**ChatComposer 拥有**：
- 文本 state：`input` / `inputHistory` / `historyIndex`
- 斜杠全套（**逻辑零改动纯搬迁**）：`slashIndex` / `slashForcedClosed` / `slashQ` / `slashFiltered` / `slashOpen` / `slashNotice` / `slashSelect`
- @ 全套（新）：`atQueryResult` / `atOpen` / `atIndex` / `atResults` / `snippetRefs`
- IME：`isComposing`（compositionstart/compositionend）
- keydown 桥接：`chatKeydownRef` / `stableChatKeydown`（搬入组件内）
- JSX：textarea + `SlashMenu` + `SnippetMentionPopover` + slashNotice + refs 托盘 + 发送/停止按钮

**保留在 WritingAssistant**：
- `messages` / 流式 `status` / 分页（`hasMore`/`oldestPosition`/`loadingMore`）/ scroll
- 文章上下文（`currentMarkdown` / `targetKind` / `targetId`）
- `transport` / `sendMessage` / `regenerate` / `stop`
- 审批锁（`approvalBlocked`）/ 恢复（`recovering`）
- `ModelSelector` / `TokenMeter`（状态在父级，作为 slot 注入）

### 4.2 接口
```tsx
type ComposerSendPayload = { text: string; snippetRefs: string[] };

<ChatComposer
  disabled={approvalBlocked || busy}
  streaming={busy}
  placeholder={approvalBlocked ? "等待代码源授权…" : "让 Agent 研究、创作…（/ 命令 · @ 灵感 · Enter 发送）"}
  inputHistory={inputHistory}
  onSend={(payload: ComposerSendPayload) => sendText(payload.text, payload.snippetRefs)}
  onStop={stop}
>
  {/* slot：ModelSelector / TokenMeter 由 WritingAssistant 注入渲染 */}
  <ModelSelector … />
  <TokenMeter … />
</ChatComposer>
```

- `children` 作为底栏 slot（模型选择 / 计量），状态留在父级避免跨组件同步。
- 发送/停止按钮由 ChatComposer 拥有：`streaming` 时显示停止按钮（调 `onStop`），否则显示发送按钮（触发内部 `submit` → `onSend`）。
- **序列化归属父级**：composer 不感知序列化，`onSend` 传出 raw text + `snippetRefs: string[]`；`WritingAssistant.sendText` 内部调纯函数 `serializeComposer` 产出最终 message。这样 inputHistory 记录 raw text（干净）、transport 拿到带标记 message。
- composer 内部 `snippetRefs` 状态为 `{ id: string; displayText: string }[]`（chip 渲染需要 displayText）；`onSend` 时 `.map(r => r.id)` 传 `string[]` 给父级。
- `ChatComposer` 用 `memo` 包裹，`onSend`/`onStop` 由父级 `useCallback` 稳定化，确保流式期间不重渲染（延续现有 ChatTextarea memo + ref 桥接的优化意图）。

### 4.3 behavior-preserving 原则
- 斜杠、历史上下键、`Enter` 发送、`Shift+Enter` 换行、approval 锁定禁用——**逻辑原样搬入，不改行为**。
- 本轮唯一新行为：@ 触发 / 检索面板 / 托盘 / 序列化。
- keydown handler 结构：现有 `if (slashOpen) { … }` 扩展为 `if (slashOpen) { … } else if (atOpen) { … }`（互斥：斜杠开时 @ 不响应，反之亦然，因为 textarea 不可能同时以 `/` 开头又在文中含未闭合 `@`）。

### 4.4 IME（中文输入法）处理
- composition 中（`isComposing === true`）`atQuery` 返回 `null`，弹层不触发——**最高频翻车点**。
- compositionend 后用最新 input + caret 重新求值。
- 纯函数把 `isComposing` 作为入参，单测直接覆盖。

---

## 5. @引用数据流

```
① textarea 输入 + caret 位置 + isComposing
        │
② atQuery(text, caretPos, isComposing)          ── 纯函数（at-commands.ts）
        │  返回 { triggerStart, triggerEnd, query } | null
        │  规则：找 caret 前、最近一个其后无空白的 @；composition 中 / @ 在词中 → null
        ▼
③ atOpen=true, query 进 state；atIndex 重置 0
        │
④ SnippetMentionPopover fetch /api/snippets/search?q=query   （debounce 150ms）
        │  键盘 ↑↓ 导航 / Enter 或 Tab 选中 / Esc 关闭 / 鼠标点击
        ▼
⑤ selectSnippet(s)
   - 删掉 textarea 里 [triggerStart..caret] 的触发文本（含 @ 与部分 query）
   - snippetRefs 去重 push（已存在则忽略 + 可闪烁高亮已存在项）
   - 关闭弹层，textarea 保持聚焦
        ▼
⑥ 托盘渲染 SnippetRefChip[]（× 可删；删到空则托盘收起）
        │
⑦ composer 发送按钮 → onSend({ text: rawText, snippetRefs: [...ids] })
        │  （composer 不序列化，只收集）
        ▼
⑧ WritingAssistant.sendText(rawText, snippetRefs)
   - serializeComposer(rawText, snippetRefs)        ── 纯函数（snippet-serialize.ts）
     → { message: rawText + {{snippet:id}} 标记段, snippetRefs }
   - inputHistory 记录 rawText（不带标记，历史干净）
   - sendMessage({ text: message }, { body: requestBody })   ← transport 拿带标记 message
        ▼
⑨ Agent 收到带 {{snippet:id}} 的 message → 调 load_snippets(ids) → system prompt 融入规则 → 生成
```

---

## 6. 纯逻辑层 API 与 TDD 用例

### 6.1 `at-commands.ts`
```ts
export type AtQueryResult = { triggerStart: number; triggerEnd: number; query: string };

/** 检测 caret 前、最近一个其后无空白的 @。composition 中 / 无匹配 → null。 */
export function atQuery(
  input: string,
  caretPos: number,
  isComposing: boolean
): AtQueryResult | null;

/** 按 query 模糊匹配 title/content/tags（大小写不敏感，子串匹配）。 */
export function filterSnippets(
  items: SnippetSearchItem[],
  query: string
): SnippetSearchItem[];
```

**`at-commands.test.ts` 用例**：
- 行首 `@` → 返回 query=""
- 文中 `…融入@产` caret 在末尾 → query="产"，triggerStart 指向 `@`
- `@` 后跟空白（`@ `）→ null
- `@` 后跟换行 → null
- caret 不在 @ 之后（`@产 品` caret 在空格后）→ null
- composition 中 → null（无论 input 形态）
- `filterSnippets`：空 query 返回全部；子串匹配 title/content/tags；大小写不敏感；无匹配返回 []

### 6.2 `snippet-serialize.ts`
```ts
export type ComposerPayload = { message: string; snippetRefs: string[] };

/** Tray 模式序列化：refs 为空 → message = text；非空 → message = text + 标记段。 */
export function serializeComposer(text: string, snippetRefs: string[]): ComposerPayload;
```

> 入参只需 `snippetRefs: string[]`（id 列表）——标记段只用 id；chip 的展示文本（displayText）是组件层关注点，不进序列化。

**标记段格式**（仅当有 refs 时追加，用 HTML 注释做可清理的分隔）：
```
{user text}

<!-- snippet-refs -->
{{snippet:clxxx1}} {{snippet:clxxx2}}
```

**`snippet-serialize.test.ts` 用例**：
- 空 refs → `{ message: text, snippetRefs: [] }`（无追加）
- 有 refs → message 以 user text 开头 + 标记段含按序 `{{snippet:id}}`；snippetRefs 为 id 数组（按入参顺序）
- refs 有重复 id → 去重（snippetRefs 与标记段都只出现一次）
- text 为空但有 refs → 标记段仍生成（边界）
- text 尾部已有换行 → 不产生多余空行

### 6.3 `load_snippets` 工具（registry.ts）
```ts
const loadSnippetsTool: InkPressToolDefinition = {
  name: "load_snippets",
  description: "加载灵感素材块的完整内容。当用户消息含 {{snippet:id}} 引用时调用。",
  inputSchema: { ids: z.array(z.string()) },
  permission: "allow",            // 只读本地未删除素材，无副作用
  category: "content",
  execute: async (_ctx, { ids }) => {
    return prisma.snippet.findMany({
      where: { id: { in: ids }, trashed: false },
      select: { id: true, title: true, content: true, kind: true,
                imageUrl: true, quoteSource: true, linkUrl: true,
                linkTitle: true, tagsJson: true },
    });
  },
};
```
注册到 `INKPRESS_TOOLS` 数组（L908-926）。

**`load-snippets.test.ts` 用例**（mock `@/lib/db` 的 `prisma.snippet.findMany`）：
- 传入 ids → findMany 被以 `{ where: { id: { in: ids }, trashed: false }, select: {...} }` 调用
- 返回值原样透传
- select 字段集合精确（不含 trashed/embedding 等敏感/无关字段）

### 6.4 `system-prompt.ts`
- `InkPressSystemPromptInput` 加 `snippetsHint?: string`。
- 在拼装数组（L149 起）插入条件 section（仿 `codeSection`）：`input.snippetsHint ? [input.snippetsHint] : []`。
- 调用方 `claude-agent-options.ts` L291-297：当消息含 `{{snippet:` 时传入融入规则文本。

**融入规则**（设计文档 5.3 的 6 条）：
1. 保持素材核心观点和事实不变，不歪曲原意
2. 表述风格对齐当前文章语气和用词
3. 在文章中自然融入，找逻辑上最合适的位置
4. 按 `{{snippet:xxx}}` 在用户消息中的顺序对应融入
5. 图文素材：保留图片引用，调整配文风格
6. 引用素材：以 blockquote 保留，可调整引入语
7. **不要把 `{{snippet:id}}` 标记回显进正文**；加载失败/不存在的素材静默跳过

**`system-prompt.test.ts` 用例**（扩展已有文件）：
- `snippetsHint` 有值 → 输出含该文本
- `snippetsHint` 为 undefined → 输出不含「灵感素材」段落，且不影响其他 section（code/type/subagent 仍按各自条件出现）

---

## 7. P0 打磨

| 文件 | 现状问题 | 修法 |
|---|---|---|
| `SnippetCard.tsx` | 只显示 `tags[0]` | 显示全部 tag，溢出折行（`flex-wrap gap-1`），tag 过多时尾部 `+N` |
| `SnippetCard.tsx` | 操作按钮仅 `onMouseEnter` 可见，键盘不可达 | 改 `focus-within`（容器聚焦族内按钮可显示）+ 按钮 `focus-visible:ring`；保留 hover 显示 |
| `SnippetCard.tsx` | 删除无确认 | `window.confirm`（软删可恢复，轻量确认即可，不引入 Dialog 组件） |
| `SnippetsView.tsx` | 筛选只在前端已加载列表上做，搜索没接 API | 加搜索输入框，接 `/api/snippets?q=`（loading / 空态）；类型/标签筛选保持客户端（已加载集合内够用） |

> 全量 cursor 分页 + 多标签 AND 组合属 P2/P3，本轮不做。

---

## 8. 边界与错误处理

| 场景 | 行为 |
|---|---|
| 中文输入法 composition | `atQuery` 返回 null，弹层不触发；compositionend 后重求值 |
| 搜索请求频率 | debounce 150ms，避免每键一请求 |
| 重复 ref | 同一 snippet 不能进托盘两次；二次选中忽略（可闪烁已存在项高亮） |
| query 为空 | 弹层显示「最近常用」（`/api/snippets/search` 无 q 时按 usageCount desc） |
| 无结果 | 空态文案「未找到匹配的灵感」 |
| API 失败 | 「加载失败，重试」按钮 |
| `Esc` | 关弹层，保留 caret 与已输入的 `@` 文本 |
| 托盘与发送按钮联动 | 有 refs 时发送按钮旁显示 `✦N` 角标 |
| 标记泄漏 | system prompt 禁止回显；本轮靠 prompt，生成结果后清理兜底留观察（不实现） |
| 斜杠与 @ 互斥 | textarea 不可能同时满足「以 `/` 开头」与「文中含未闭合 `@`」，keydown 分支互斥处理 |

---

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| ChatComposer 提取碰坏斜杠/历史/发送现有行为 | behavior-preserving 纯搬迁；提取后跑完整手动验证清单（§10）；typecheck + build 必过 |
| WritingAssistant 流式重渲染影响 composer 性能 | `ChatComposer` memo + `onSend`/`onStop` `useCallback` 稳定化；延续现有 ref 桥接模式 |
| `{{snippet:id}}` 标记泄漏进正文 | system prompt 显式禁止；标记段用 HTML 注释包裹便于后续兜底清理 |
| 仅纯逻辑层 TDD，React 交互无自动化覆盖 | 接受此取舍；§10 手动验证清单覆盖 IME / 键盘导航 / 全链路 |
| IME 翻车 | `isComposing` 作为纯函数入参单测覆盖；composition 中 atQuery 返回 null |

---

## 10. 手动验证清单

提取 + @ 落地后必须全过：

**A. 斜杠/历史/发送回归（behavior-preserving 验证）**
- [ ] 输入 `/` 弹斜杠菜单，↑↓ 导航，Enter/Tab 选中，Esc 关闭
- [ ] 内置命令立即执行；Skill 命令插入 token + 空格
- [ ] 上下键在首行/末行回溯/前进历史输入
- [ ] `Enter` 发送，`Shift+Enter` 换行
- [ ] approval 锁定时输入框禁用 + placeholder 切换
- [ ] 流式期间发送按钮变停止，停止可中断

**B. @引用新功能**
- [ ] 文中输入 `@` 弹检索面板，继续输入实时过滤
- [ ] 中文连续输入（composition）不被弹层打断
- [ ] ↑↓ 导航，Enter/Tab 选中，Esc 关闭且保留 `@` 文本
- [ ] 选中后触发文本（`@` + 部分 query）从 textarea 删除，chip 进托盘
- [ ] 托盘 chip 的 `×` 可删；删到空托盘收起
- [ ] 同一素材二次选中不重复进托盘
- [ ] 发送后 inputHistory 记录的是 raw text（无标记）
- [ ] agent 收到 `{{snippet:id}}` → 调 load_snippets → 正文自然融入、无标记回显

**C. P0 打磨**
- [ ] 卡片显示全部 tag（不只第一个）
- [ ] Tab 聚焦到操作按钮可见 + 有 focus ring
- [ ] 删除弹 confirm
- [ ] 搜索框输入 → 接 API → 列表更新；空结果有空态

**D. 构建**
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test`（vitest）全绿
- [ ] `pnpm build` 通过

---

## 11. 实现顺序（建议）

1. **纯逻辑层 + 测试先行**（TDD 红→绿）：`at-commands.ts` + 测试 → `snippet-serialize.ts` + 测试 → `load_snippets` 工具 + 测试 → `system-prompt.ts` 扩展 + 测试。
2. **ChatComposer 提取**（behavior-preserving）：新建 `ChatComposer.tsx`，把斜杠/历史/发送/state/keydown/JSX 原样搬入；`WritingAssistant` 改为渲染 `<ChatComposer>`；跑回归清单 A + 构建 D。
3. **@ 接入 ChatComposer**：`SnippetMentionPopover` + `SnippetRefChip`；composer 内加 @ state / keydown 分支 / 托盘 / 序列化接线；接 `/api/snippets/search`；跑清单 B。
4. **system prompt + load_snippets 闭环**：`claude-agent-options.ts` 传 `snippetsHint`；端到端验证 agent 调工具 + 融入。
5. **P0 打磨**：`SnippetCard` 多 tag / 键盘可达 / 删除确认；`SnippetsView` 搜索框接 API；跑清单 C。
6. **全量构建 + 清单 D**。

---

## 12. 与设计文档的偏差说明

本 spec 相对 `docs/features/snippets-design.md` 的两处有意偏差：
1. **chip 架构**：设计文档画的是 chip 内联在输入框里（需 contenteditable）。本 spec 改为 **Tray 托盘模式**——因 `WritingAssistant` 现为原生 textarea，contenteditable 改造成本与中文 IME/粘贴/光标风险过高；托盘模式纯函数序列化、零管线改动、风险可控。代价：失去 chip 在文中的位置语义，但设计文档 system prompt 本就让 AI 自行决定融入位置（规则 3），位置语义非必需。
2. **ChatComposer 提取**：设计文档未提及（其文件结构规划里输入逻辑仍在 WritingAssistant）。本 spec 增补此提取，作为「输入元素会越来越多」的前瞻性结构升级。
