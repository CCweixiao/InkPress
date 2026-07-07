# 素材块 P1（AI @引用 + ChatComposer 提取 + P0 打磨）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通「灵感素材 → AI 写作」主线（对话框 `@` 触发检索 → chip 进托盘 → 发送序列化为 `{{snippet:id}}` → agent 调 `load_snippets` 加载 → system prompt 融入），并把 `WritingAssistant` 的输入表面提取为可扩展的 `ChatComposer` 组件，顺带打磨 `/snippets` 页面 UX。

**Architecture:** 严格分层——纯逻辑层（TDD：`at-commands`/`snippet-serialize`/`load_snippets` 工具/`system-prompt` section，全部在 `tests/unit/` 红绿）+ 组件层（`ChatComposer` behavior-preserving 提取 + `SnippetMentionPopover`/`SnippetRefChip` + `@` 接线，靠 typecheck/build/手动验证）+ 已有数据层（不动）。chip 走 Tray 托盘模式（refs 在输入框下方，textarea 保持纯文本）。

**Tech Stack:** Next.js App Router · React · TypeScript · vitest（`tests/unit/`，env=node，`@`→`src`）· Prisma 7 · zod 4 · `@ai-sdk/react` useChat。

## Global Constraints

- **TDD 边界**：仅纯逻辑层写单测（Tasks 1–4）。组件层（Tasks 5–9）不写单测、不引入 RTL/e2e，靠 typecheck + build + 手动验证清单。
- **不自行 commit**：每个任务结束运行测试/typecheck 确认绿后**只报告改动**，**不执行 `git commit`**。需要提交时由用户统一指示（或全部完成一次性提交）。本计划所有「Checkpoint」步骤即替代 commit。
- **ChatComposer 提取是 behavior-preserving**：斜杠 / 历史上下键 / Enter 发送 / Shift+Enter 换行 / approval 锁定禁用——逻辑零改动搬迁，Task 5 完成后必须跑回归清单 A 全绿才能进 Task 7。
- **IME 闸门**：`@` 检测在 composition 中返回 null（`isComposing` 入参），中文连续输入不被弹层打断。
- **标记格式**：序列化仅在有 refs 时追加 `<!-- snippet-refs -->\n{{snippet:id}} {{snippet:id}}` 段；system prompt 禁止 agent 回显标记。
- **load_snippets 工具**：`permission: "allow"`，`category: "memory"`（注：spec §6.3 写的 `"content"` 不是合法 `ToolCategory` 值；合法值为 skill/article/technical-document/asset/code/git/web/memory/subtask，选 `memory`——灵感记忆库，最贴近且前端有兜底图标）。
- **spec 路径**：`docs/superpowers/specs/2026-07-07-snippets-p1-at-mention-composer-design.md`（权威设计，与本计划冲突时以 spec 为准，但本计划已修正上述两处 spec 笔误）。

---

## File Structure

| 文件 | 责任 | 任务 |
|---|---|---|
| `src/components/editor/at-commands.ts`（新） | `@` 触发检测 / 过滤纯函数 + `SnippetSearchItem` 类型 | Task 1 |
| `src/lib/ai/snippet-serialize.ts`（新） | `serializeComposer(text, ids) → {message, snippetRefs}` | Task 2 |
| `src/lib/ai/tools/registry.ts`（改） | 注册 `load_snippets` 工具 + display factory | Task 3 |
| `src/lib/ai/system-prompt.ts`（改） | `InkPressSystemPromptInput.snippetsHint` + 条件 section | Task 4 |
| `src/lib/ai/claude-agent-options.ts`（改） | 消息含 `{{snippet:` 时传 `snippetsHint` | Task 4 |
| `tests/unit/at-commands.test.ts`（新） | atQuery / filterSnippets 单测 | Task 1 |
| `tests/unit/snippet-serialize.test.ts`（新） | serializeComposer 单测 | Task 2 |
| `tests/unit/load-snippets.test.ts`（新） | load_snippets execute（mock prisma） | Task 3 |
| `tests/unit/system-prompt.test.ts`（扩） | snippetsHint section | Task 4 |
| `src/components/editor/ChatComposer.tsx`（新） | 输入表面（斜杠搬迁 + @ + 托盘 + IME） | Task 5 / Task 7 |
| `src/components/editor/SnippetMentionPopover.tsx`（新） | `@` 浮动检索面板 | Task 6 |
| `src/components/editor/SnippetRefChip.tsx`（新） | 托盘可删 chip | Task 6 |
| `src/components/editor/WritingAssistant.tsx`（改） | 抽出输入表面，渲染 `<ChatComposer>` | Task 5 |
| `src/components/snippets/SnippetCard.tsx`（改） | 多 tag / 键盘可达 / 删除确认 | Task 8 |
| `src/components/snippets/SnippetsView.tsx`（改） | 搜索框接 `/api/snippets?q=` | Task 9 |

---

## Task 1: at-commands.ts — @触发检测与过滤（TDD）

**Files:**
- Create: `src/components/editor/at-commands.ts`
- Test: `tests/unit/at-commands.test.ts`

**Interfaces:**
- Produces: `atQuery(input, caretPos, isComposing): AtQueryResult | null`、`filterSnippets(items, query): SnippetSearchItem[]`、类型 `AtQueryResult` / `SnippetSearchItem`（`SnippetSearchItem` 字段对齐 `/api/snippets/search` 返回的 `items[]`，Task 6/7 消费）。

`SnippetSearchItem` 对齐 `src/app/api/snippets/search/route.ts` L43-52 的返回结构。

- [ ] **Step 1: 写失败测试** `tests/unit/at-commands.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { atQuery, filterSnippets, type SnippetSearchItem } from "../../src/components/editor/at-commands";

const item = (over: Partial<SnippetSearchItem> = {}): SnippetSearchItem => ({
  id: "x",
  title: "标题",
  summary: "摘要",
  kind: "text",
  tags: [],
  imageUrl: null,
  color: null,
  updatedAt: "2026-07-07T00:00:00.000Z",
  ...over,
});

describe("atQuery", () => {
  it("行首 @ 返回 query 空串", () => {
    expect(atQuery("@", 1, false)).toEqual({ triggerStart: 0, triggerEnd: 1, query: "" });
  });

  it("文中 …融入@产 caret 在末尾 → query=产，triggerStart 指向 @", () => {
    const input = "帮我写文章，融入@产";
    expect(atQuery(input, input.length, false)).toEqual({
      triggerStart: 8,
      triggerEnd: input.length,
      query: "产",
    });
  });

  it("@ 后跟空白 → null", () => {
    expect(atQuery("@ x", 3, false)).toBeNull();
  });

  it("@ 后跟换行 → null", () => {
    expect(atQuery("@\nx", 3, false)).toBeNull();
  });

  it("caret 不在 @ 之后（@产 品，caret 在空格后）→ null", () => {
    expect(atQuery("@产 品", 5, false)).toBeNull();
  });

  it("无 @ → null", () => {
    expect(atQuery("普通文字", 4, false)).toBeNull();
  });

  it("多个 @ 取最近的（foo@bar @baz）", () => {
    const input = "foo@bar @baz";
    expect(atQuery(input, input.length, false)?.query).toBe("baz");
  });

  it("composition 中 → null（无论形态）", () => {
    expect(atQuery("@产", 2, true)).toBeNull();
  });
});

describe("filterSnippets", () => {
  const items = [
    item({ id: "1", title: "产品设计", summary: "减法", tags: ["阅读摘录"] }),
    item({ id: "2", title: "技术灵感", summary: "缓存策略", tags: ["后端"] }),
    item({ id: "3", title: "用户增长", summary: "价值传递", tags: ["产品想法"] }),
  ];

  it("空 query 返回全部", () => {
    expect(filterSnippets(items, "")).toHaveLength(3);
  });

  it("子串匹配 title（大小写不敏感）", () => {
    expect(filterSnippets(items, "产品")).toHaveLength(1);
    expect(filterSnippets(items, "PRODUCT")).toHaveLength(1);
  });

  it("子串匹配 summary", () => {
    expect(filterSnippets(items, "缓存")).toHaveLength(1);
  });

  it("子串匹配 tags", () => {
    expect(filterSnippets(items, "后端")).toHaveLength(1);
  });

  it("无匹配返回空数组", () => {
    expect(filterSnippets(items, "不存在的内容xyz")).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/unit/at-commands.test.ts`
Expected: FAIL —— `Cannot find module '../../src/components/editor/at-commands'`

- [ ] **Step 3: 写最小实现** `src/components/editor/at-commands.ts`

```ts
/**
 * @ 灵感引用 —— 检测与过滤纯函数（与 slash-commands.tsx 数据层平行）。
 * 触发逻辑在 ChatComposer 组件层调用；这里只做无副作用的判定，便于单测。
 */

/** 对齐 /api/snippets/search 返回的精简字段（route.ts items[]）。 */
export type SnippetSearchItem = {
  id: string;
  title: string;
  summary: string;
  kind: string;
  tags: string[];
  imageUrl: string | null;
  color: string | null;
  updatedAt: string;
};

export type AtQueryResult = {
  /** 命中的 @ 在 input 中的下标。 */
  triggerStart: number;
  /** caret 位置（待删除区间的右端）。 */
  triggerEnd: number;
  /** @ 之后、caret 之前的查询文本。 */
  query: string;
};

/**
 * 检测 caret 之前最近的、且其后到 caret 无空白的 @。
 * composition 中（中文输入法组字）、无 @、@ 与 caret 间含空白 → null。
 */
export function atQuery(
  input: string,
  caretPos: number,
  isComposing: boolean
): AtQueryResult | null {
  if (isComposing) return null;
  const before = input.slice(0, caretPos);
  const atIdx = before.lastIndexOf("@");
  if (atIdx === -1) return null;
  const query = before.slice(atIdx + 1);
  if (/[\s\n]/.test(query)) return null;
  return { triggerStart: atIdx, triggerEnd: caretPos, query };
}

/** 按 query 模糊匹配 title/summary/tags（大小写不敏感子串）。空 query 返回全部。 */
export function filterSnippets(
  items: SnippetSearchItem[],
  query: string
): SnippetSearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.summary.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/unit/at-commands.test.ts`
Expected: PASS（全部用例绿）

- [ ] **Step 5: Checkpoint**

Run: `pnpm typecheck`
Expected: 通过，无报错。报告改动（不 commit）。

---

## Task 2: snippet-serialize.ts — Composer 序列化（TDD）

**Files:**
- Create: `src/lib/ai/snippet-serialize.ts`
- Test: `tests/unit/snippet-serialize.test.ts`

**Interfaces:**
- Produces: `serializeComposer(text: string, snippetRefs: string[]): ComposerPayload`，`ComposerPayload = { message: string; snippetRefs: string[] }`。Task 7 的 ChatComposer 在 onSend 前由父级调用；Task 4 的 system prompt 消费同款 `{{snippet:id}}` 标记。

- [ ] **Step 1: 写失败测试** `tests/unit/snippet-serialize.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { serializeComposer } from "../../src/lib/ai/snippet-serialize";

describe("serializeComposer", () => {
  it("空 refs → message=text，无标记段", () => {
    expect(serializeComposer("你好", [])).toEqual({ message: "你好", snippetRefs: [] });
  });

  it("有 refs → message 含按序 {{snippet:id}} + snippetRefs id 数组", () => {
    const r = serializeComposer("帮我写文章", ["cl1", "cl2"]);
    expect(r.snippetRefs).toEqual(["cl1", "cl2"]);
    expect(r.message.startsWith("帮我写文章")).toBe(true);
    expect(r.message).toContain("<!-- snippet-refs -->");
    expect(r.message).toContain("{{snippet:cl1}} {{snippet:cl2}}");
  });

  it("重复 id 去重（保持首次出现顺序）", () => {
    const r = serializeComposer("x", ["cl1", "cl2", "cl1"]);
    expect(r.snippetRefs).toEqual(["cl1", "cl2"]);
    const markers = r.message.match(/\{\{snippet:cl\d\}\}/g) ?? [];
    expect(markers).toEqual(["{{snippet:cl1}}", "{{snippet:cl2}}"]);
  });

  it("text 为空但有 refs → 仍生成标记段，且不以换行开头", () => {
    const r = serializeComposer("", ["cl1"]);
    expect(r.message).toBe("<!-- snippet-refs -->\n{{snippet:cl1}}");
    expect(r.snippetRefs).toEqual(["cl1"]);
  });

  it("text 尾部已有换行 → 不产生多余空行（至多一个空行）", () => {
    const r = serializeComposer("你好\n", ["cl1"]);
    expect(r.message).toBe("你好\n\n<!-- snippet-refs -->\n{{snippet:cl1}}");
    expect(r.message.includes("\n\n\n")).toBe(false);
  });

  it("过滤 falsy id", () => {
    const r = serializeComposer("x", ["cl1", "", "cl2"]);
    expect(r.snippetRefs).toEqual(["cl1", "cl2"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/unit/snippet-serialize.test.ts`
Expected: FAIL —— `Cannot find module '../../src/lib/ai/snippet-serialize'`

- [ ] **Step 3: 写最小实现** `src/lib/ai/snippet-serialize.ts`

```ts
/**
 * Tray 托盘模式的 Composer 序列化。
 *
 * refs 为空 → message = 原文（普通消息）。
 * refs 非空 → message = 原文 + 标记段（HTML 注释做可清理分隔 + 按序 {{snippet:id}}）。
 * agent 端按既有 tool-routing 解析 {{snippet:id}} 并调 load_snippets；system prompt 禁止回显标记。
 *
 * 入参只需 id 列表：标记段只用 id，chip 的展示文本（displayText）是组件层关注点，不进序列化。
 */
export type ComposerPayload = {
  message: string;
  snippetRefs: string[];
};

const SNIPPET_REFS_MARKER = "<!-- snippet-refs -->";

export function serializeComposer(
  text: string,
  snippetRefs: string[]
): ComposerPayload {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of snippetRefs ?? []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) return { message: text, snippetRefs: [] };
  const markers = ids.map((id) => `{{snippet:${id}}}`).join(" ");
  const body = text.replace(/\n+$/, "");
  const message = body.length
    ? `${body}\n\n${SNIPPET_REFS_MARKER}\n${markers}`
    : `${SNIPPET_REFS_MARKER}\n${markers}`;
  return { message, snippetRefs: ids };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/unit/snippet-serialize.test.ts`
Expected: PASS

- [ ] **Step 5: Checkpoint**

Run: `pnpm typecheck`
Expected: 通过。报告改动（不 commit）。

---

## Task 3: load_snippets 工具（registry.ts，TDD）

**Files:**
- Modify: `src/lib/ai/tools/registry.ts`（加 display factory + tool 定义 + 注册到 `INKPRESS_TOOLS`）
- Test: `tests/unit/load-snippets.test.ts`

**Interfaces:**
- Consumes: `InkPressToolDefinition`（registry.ts L71-105）、`prisma.snippet`（`@/lib/db`，schema 已有 `Snippet` 模型）、`ToolDisplayFactory`（`agent-runtime-events.ts` L108）。
- Produces: 工具裸名 `load_snippets`（模型侧 `mcp__inkpress__load_snippets`），注册进 `INKPRESS_TOOLS`（L908-926）。

- [ ] **Step 1: 写失败测试** `tests/unit/load-snippets.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { snippet: { findMany } },
}));

import { INKPRESS_TOOLS } from "../../src/lib/ai/tools/registry";
import type { InkPressToolContext } from "../../src/lib/ai/tools/registry";

const ctx = {} as InkPressToolContext;

function loadSnippets() {
  const tool = INKPRESS_TOOLS.find((t) => t.name === "load_snippets");
  if (!tool) throw new Error("load_snippets tool not registered");
  return tool;
}

describe("load_snippets tool", () => {
  beforeEach(() => findMany.mockReset());

  it("已注册且 permission=allow, category=memory", () => {
    const t = loadSnippets();
    expect(t.permission).toBe("allow");
    expect(t.category).toBe("memory");
  });

  it("execute 按 ids 查询未删除素材，select 精确字段，过滤 trashed", async () => {
    findMany.mockResolvedValue([{ id: "cl1" }]);
    await loadSnippets().execute(ctx, { ids: ["cl1", "cl2"] });
    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { in: ["cl1", "cl2"] }, trashed: false });
    expect(arg.select).toEqual({
      id: true,
      title: true,
      content: true,
      kind: true,
      imageUrl: true,
      quoteSource: true,
      linkUrl: true,
      linkTitle: true,
      tagsJson: true,
    });
  });

  it("execute 原样透传 findMany 返回值", async () => {
    const rows = [{ id: "cl1", title: "t" }];
    findMany.mockResolvedValue(rows);
    const out = await loadSnippets().execute(ctx, { ids: ["cl1"] });
    expect(out).toBe(rows);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/unit/load-snippets.test.ts`
Expected: FAIL —— `load_snippets tool not registered`

- [ ] **Step 3: 改 registry.ts — 加 display factory**

在 `articleAssetsDisplay`（L150-162）之后插入（紧挨 `setArticleDigestDisplay` 之前）：

```ts
const loadSnippetsDisplay: ToolDisplayFactory = ({ phase, output }) => {
  const o = outOf(output);
  return {
    title: "加载灵感素材",
    activityKind: "read",
    summary:
      phase === "completed"
        ? `已加载 ${Array.isArray(o) ? o.length : 0} 条灵感`
        : phase === "failed"
          ? undefined
          : "正在加载灵感素材",
  };
};
```

- [ ] **Step 4: 改 registry.ts — 加 tool 定义**

在 `articleAssetsTool`（L350-387）之后插入（与 articleAssetsTool 同款，照抄结构）：

```ts
const loadSnippetsTool: InkPressToolDefinition = {
  name: "load_snippets",
  permission: "allow",
  category: "memory",
  version: "1.0.0",
  display: loadSnippetsDisplay,
  description:
    "加载灵感素材块的完整内容。当用户消息含 {{snippet:id}} 引用时调用，传入出现的全部 id；返回每条的标题/正文/类型/图片/引用出处/链接/标签，用于自然融入文章。",
  inputSchema: {
    ids: z.array(z.string().min(1)).min(1),
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (_ctx, args) => {
    const ids = Array.isArray(args.ids) ? (args.ids as string[]) : [];
    return prisma.snippet.findMany({
      where: { id: { in: ids }, trashed: false },
      select: {
        id: true,
        title: true,
        content: true,
        kind: true,
        imageUrl: true,
        quoteSource: true,
        linkUrl: true,
        linkTitle: true,
        tagsJson: true,
      },
    });
  },
};
```

- [ ] **Step 5: 改 registry.ts — 注册到 INKPRESS_TOOLS**

在 `INKPRESS_TOOLS` 数组（L908-926）里，`articleAssetsTool,` 下一行加：

```ts
  loadSnippetsTool,
```

（即数组变为 `… articleAssetsTool, loadSnippetsTool, setArticleDigestTool, …`）

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm test tests/unit/load-snippets.test.ts`
Expected: PASS

- [ ] **Step 7: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck 通过；全套 vitest 绿（含既有用例）。报告改动（不 commit）。

---

## Task 4: system-prompt snippetsHint + 调用方接线（TDD）

**Files:**
- Modify: `src/lib/ai/system-prompt.ts`（加 `snippetsHint` 字段 + 条件 section）
- Modify: `src/lib/ai/claude-agent-options.ts`（消息含 `{{snippet:` 时传 `snippetsHint`）
- Test: `tests/unit/system-prompt.test.ts`（扩）

**Interfaces:**
- Consumes: `InkPressSystemPromptInput`（system-prompt.ts L13-31）、`buildClaudeAgentOptions` 入参（claude-agent-options.ts，需找到 `input` 里能拿到当前用户消息文本的来源）。
- Produces: prompt 多一个条件 section；agent 收到带 `{{snippet:id}}` 的消息时拿到融入规则。

> **关于 snippetsHint 的来源**：`buildClaudeAgentOptions` 的 `input` 是否含「即将发送的用户消息文本」需先确认。若 `useChat` 的消息在客户端序列化后通过 `/api/ai/chat` body 传到 runtime，则 runtime 组装 system prompt 时可从「本轮 user message」检测 `{{snippet:`。**Step 1 之前先读 `src/app/api/ai/chat/route.ts` 与 `claude-agent-options.ts` 全文**，定位「本轮用户消息文本」在 runtime 侧的拿法；若拿不到逐条消息，则退而用「target.markdown 不变 + 客户端在 body 里带 `hasSnippetRefs: true` 标志」由 runtime 读取。本步骤按「runtime 能拿到本轮 user 文本」实现，拿不到则改用 body 标志（见 Step 4 备选）。

- [ ] **Step 1: 写失败测试** — 扩 `tests/unit/system-prompt.test.ts`，在文件末尾追加：

```ts
describe("snippetsHint section", () => {
  const baseInput = {
    target: { kind: "article" as const, title: "T", markdown: "" },
    skillCatalog: [],
  };

  it("snippetsHint 有值 → 输出含该文本与融入规则", () => {
    const prompt = buildInkPressSystemPrompt({
      ...baseInput,
      snippetsHint: "用户消息引用了灵感素材。",
    });
    expect(prompt).toContain("灵感素材");
    expect(prompt).toContain("{{snippet:");
    expect(prompt).toContain("保持素材核心观点");
  });

  it("snippetsHint 缺省 → 不含灵感素材段落，且不影响 web/code 段落", () => {
    const prompt = buildInkPressSystemPrompt({
      ...baseInput,
      tavilyApiKey: "tvly-test",
    });
    expect(prompt).not.toContain("灵感素材");
    expect(prompt).toContain("web_fetch"); // 其他段落仍在
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/unit/system-prompt.test.ts`
Expected: FAIL —— `snippetsHint` 不在 `InkPressSystemPromptInput` 上 / prompt 不含「灵感素材」

- [ ] **Step 3: 改 system-prompt.ts — 加字段**

在 `InkPressSystemPromptInput`（L13-31）末尾 `tavilyApiKey?: string;` 之后加：

```ts
  /** P1：消息含 {{snippet:id}} 引用灵感素材时注入的融入规则文本（无引用则缺省）。 */
  snippetsHint?: string;
```

- [ ] **Step 4: 改 system-prompt.ts — 加条件 section**

在 `codeSection` 定义（L106-122）之后、`const tavilyApiKey`（L124）之前，插入：

```ts
  // P1：灵感素材融入规则（消息含 {{snippet:id}} 时由调用方注入 snippetsHint）。
  const snippetsSection = input.snippetsHint?.trim() ? ["", input.snippetsHint.trim()] : [];
```

然后在最终 `return [ … ].join("\n")` 数组（L149-181）里，把 `...snippetsSection,` 加到 `...typeSection,` 之后、`...subagentSection,` 之前（即与 codeSection/webSection/typeSection 并列展开）。`snippetsHint` 文案由调用方（Step 5）传入，内容为融入规则（见下）。

**融入规则文本常量**（放在 system-prompt.ts 顶部 `ARTICLE_BODY_BUDGET` 附近，导出供 Step 5 引用）：

```ts
/** P1：消息含 {{snippet:id}} 时注入的灵感融入指令。 */
export const SNIPPET_FUSION_HINT = `## 灵感素材融入
用户消息中的 {{snippet:xxx}} 引用了灵感素材，你已通过 load_snippets 加载其完整内容。融入规则：
1. 保持素材核心观点与事实不变，不歪曲原意。
2. 表述风格对齐当前文章的语气与用词习惯。
3. 在文章中自然融入，找到逻辑上最合适的位置，不生硬拼接。
4. 按 {{snippet:xxx}} 在用户消息中的顺序对应融入文章前后结构。
5. 图文素材：保留图片引用，调整配文风格。
6. 引用素材：以 blockquote 形式保留，可调整引入语。
7. 不要把 {{snippet:id}} 标记回显进正文；加载失败/不存在的素材静默跳过。`;
```

- [ ] **Step 5: 改 claude-agent-options.ts — 注入 snippetsHint**

先读 `src/lib/ai/claude-agent-options.ts` 与 `src/app/api/ai/chat/route.ts`，确认 runtime 侧如何拿到「本轮 user 消息文本」。在 `buildInkPressSystemPrompt({ … })` 调用处（L291-297）追加 `snippetsHint`：

```ts
    systemPrompt: buildInkPressSystemPrompt({
      target: input.target,
      skillCatalog,
      preferredSkillIds: input.preferredSkillIds,
      codeSource: input.codeSource,
      tavilyApiKey: webResearch.tavilyApiKey,
      snippetsHint: collectUserText(input).includes("{{snippet:")
        ? SNIPPET_FUSION_HINT
        : undefined,
    }),
```

其中 `collectUserText(input)` 需在 claude-agent-options.ts 内实现——取 input 中本轮最后一条 user message 的 text。**实现方式取决于 Step 1 的阅读结论**：
- 若 `input` 含 `messages: UIMessage[]` → `input.messages.filter(m => m.role === "user").slice(-1)[0]` 的文本拼接。
- 若 runtime 拿不到逐条消息 → 改 `/api/ai/chat` 在 body 解析时读最后一条 user part 文本，传入 `input` 新增字段 `lastUserText?: string`；`collectUserText` 直接返回它。

`SNIPPET_FUSION_HINT` 从 `./system-prompt` import。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm test tests/unit/system-prompt.test.ts`
Expected: PASS

- [ ] **Step 7: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: 通过；全套绿。报告改动（不 commit）。

---

## Task 5: ChatComposer 提取（behavior-preserving，无 @）

**Files:**
- Create: `src/components/editor/ChatComposer.tsx`
- Modify: `src/components/editor/WritingAssistant.tsx`

**目标**：把 WritingAssistant 里散在顶层的「输入表面」原样搬进新组件 `ChatComposer`，行为不变（斜杠 / 历史上下键 / Enter 发送 / Shift+Enter 换行 / approval 锁定禁用 / 流式停止按钮）。**本任务不加任何 @ 逻辑**（Task 7 再加）。

**搬迁来源（WritingAssistant.tsx 当前行号，执行时以实际为准）**：
- `ChatTextarea` memo 组件：L1542-1571（整块搬进 ChatComposer.tsx 或保留在原文件 import——**搬到 ChatComposer.tsx 内**，因仅 composer 用）
- 输入 state：`input`/`setInput`（L1611）、`inputHistory`/`setInputHistory`（L1618）、`historyIndex` ref（L1619）
- 斜杠 state 与派生：`skills`/`slashCommands`/`slashIndex`/`slashForcedClosed`/`slashQ`/`slashFiltered`/`slashOpen`/`slashNotice`（L1638-1673）+ `/api/ai/skills` fetch effect（L1643-1654）
- `handleInputChange`（L1911-1917）、`chatKeydownRef`/`stableChatKeydown`（L1919-1925）、keydown effect（L2068-2128）
- `slashSelect`（L2027-2036）、`submit`（L2038-2065）
- 输入区 JSX：`<div className="border-t p-3"> … </div>`（L2505-2585，含 SlashMenu / slashNotice / approval 通知 / ChatTextarea / 底栏 ModelSelector+TokenMeter+发送/停止按钮）

**留在 WritingAssistant**：`messages`/`status`/分页/scroll/transport/`sendMessage`/`regenerate`/`stop`/`requestBody`/`approvalBlocked`/`busy`/`clearConversation`/`sendText`/`ModelSelector`+`TokenMeter` 的状态。

- [ ] **Step 1: 创建 `src/components/editor/ChatComposer.tsx`**

完整骨架（搬迁块用注释标明来源行号，原样复制；新写的胶水代码已完整给出）：

```tsx
"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Square, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SlashMenu } from "./slash-commands";
import {
  BUILTIN_SLASH_COMMANDS,
  buildSkillCommands,
  filterSlashCommands,
  parseSlashCommand,
  slashQuery,
  type SlashCommand,
} from "./slash-commands";
import type { SkillCatalogItem } from "@/lib/ai/skills";

/** Composer 发送载荷。snippetRefs 与 forceSkillIds 互斥（@ 引用 vs /skill 命令）。 */
export type ComposerSendPayload = {
  text: string;
  snippetRefs: string[];
  forceSkillIds?: string[];
};

interface ChatComposerProps {
  /** 输入禁用（approval 锁定或非流式空输入场景）。 */
  disabled: boolean;
  /** 是否正在流式生成（控制发送/停止按钮切换）。 */
  streaming: boolean;
  placeholder: string;
  /** approval 锁定时额外的占位/样式提示（与 disabled 配合）。 */
  approvalBlocked?: boolean;
  inputHistory: string[];
  onSend: (payload: ComposerSendPayload) => void;
  onClearConversation: () => void | Promise<void>;
  onStop: () => void;
  children?: React.ReactNode;
}

/**
 * 隔离的 textarea：memo 化避免流式 chunk 引起的父级重渲染传递到输入框。
 * 父级用 ref 桥接 onKeyDown，使 handler 引用在渲染间稳定。（自 WritingAssistant L1542-1571 原样搬入）
 */
const ChatTextarea = memo(function ChatTextarea({
  value,
  disabled,
  placeholder,
  className,
  onChange,
  onKeyDown,
}: {
  value: string;
  disabled: boolean;
  placeholder: string;
  className: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <textarea
      value={value}
      disabled={disabled}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={className}
    />
  );
});

function ChatComposerImpl({
  disabled,
  streaming,
  placeholder,
  approvalBlocked = false,
  inputHistory,
  onSend,
  onClearConversation,
  onStop,
  children,
}: ChatComposerProps) {
  const [input, setInput] = useState("");
  const historyIndex = useRef<number | null>(null);

  // ── 斜杠命令（自 WritingAssistant L1638-1673 原样搬入）──
  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const slashCommands = useMemo<SlashCommand[]>(
    () => [...BUILTIN_SLASH_COMMANDS, ...buildSkillCommands(skills)],
    [skills]
  );
  useEffect(() => {
    let active = true;
    fetch("/api/ai/skills")
      .then((r) => r.json())
      .then((data: { skills?: SkillCatalogItem[] }) => {
        if (active && Array.isArray(data.skills)) setSkills(data.skills);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const [slashIndex, setSlashIndex] = useState(0);
  const [slashForcedClosed, setSlashForcedClosed] = useState(false);
  const slashQ = slashQuery(input);
  const slashFiltered = useMemo(
    () =>
      slashQ && !slashForcedClosed
        ? filterSlashCommands(slashCommands, slashQ)
        : [],
    [slashQ, slashForcedClosed, slashCommands]
  );
  const slashOpen = slashFiltered.length > 0;
  useEffect(() => {
    setSlashIndex(0);
  }, [slashQ]);
  const [slashNotice, setSlashNotice] = useState("");

  // ── 稳定 callback（自 WritingAssistant L1911-1925 原样搬入）──
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      setSlashForcedClosed(false);
    },
    []
  );
  const chatKeydownRef = useRef<
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  >(() => {});
  const stableChatKeydown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => chatKeydownRef.current(e),
    []
  );

  // ── slashSelect / submit（自 WritingAssistant L2027-2065 原样搬入，
  //      仅把 clearConversation/sendText 改为 props；sendText → onSend）──
  function slashSelect(command: SlashCommand) {
    setSlashForcedClosed(false);
    if (command.kind === "clear") {
      setInput("");
      void onClearConversation();
      return;
    }
    setInput(`${command.token} `);
  }

  async function submit() {
    const text = input.trim();
    if (!text || disabled) return;
    const parsed = parseSlashCommand(text, slashCommands);
    if (parsed) {
      if (parsed.command.kind === "clear") {
        setInput("");
        setSlashForcedClosed(false);
        await onClearConversation();
        return;
      }
      if (!parsed.args.trim()) {
        setSlashNotice(
          `请输入要发送的内容，例如：${parsed.command.token} 写一篇关于…`
        );
        window.setTimeout(() => setSlashNotice(""), 4000);
        return;
      }
      onSend({
        text,
        snippetRefs: [],
        forceSkillIds: parsed.command.skillKey ? [parsed.command.skillKey] : undefined,
      });
      setInput("");
      setSlashForcedClosed(false);
      return;
    }
    onSend({ text, snippetRefs: [] });
    setInput("");
    setSlashForcedClosed(false);
  }

  // ── keydown（自 WritingAssistant L2068-2128 原样搬入；
  //      busy → disabled；history 取自 props inputHistory）──
  useEffect(() => {
    chatKeydownRef.current = (event) => {
      if (slashOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashIndex((i) => Math.min(slashFiltered.length - 1, i + 1));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const cmd = slashFiltered[slashIndex] ?? slashFiltered[0];
          if (cmd) slashSelect(cmd);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSlashForcedClosed(true);
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submit();
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const el = event.currentTarget;
        const atFirstLine =
          el.value.slice(0, el.selectionStart).indexOf("\n") === -1;
        const atLastLine =
          el.value.slice(el.selectionStart).indexOf("\n") === -1;
        if (event.key === "ArrowUp" && atFirstLine && inputHistory.length) {
          event.preventDefault();
          const next =
            historyIndex.current === null
              ? inputHistory.length - 1
              : Math.max(0, historyIndex.current - 1);
          historyIndex.current = next;
          setInput(inputHistory[next]);
        } else if (
          event.key === "ArrowDown" &&
          atLastLine &&
          historyIndex.current !== null
        ) {
          event.preventDefault();
          if (historyIndex.current < inputHistory.length - 1) {
            historyIndex.current += 1;
            setInput(inputHistory[historyIndex.current]);
          } else {
            historyIndex.current = null;
            setInput("");
          }
        }
      }
    };
  });

  const busy = streaming;

  return (
    <div className="border-t p-3">
      <div className="relative rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
        {slashOpen && (
          <SlashMenu
            commands={slashFiltered}
            activeIndex={slashIndex}
            onSelect={slashSelect}
          />
        )}
        {slashNotice && (
          <div className="pointer-events-none absolute -top-2 left-2 flex -translate-y-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
            {slashNotice}
          </div>
        )}
        {approvalBlocked && !busy && (
          <div className="pointer-events-none absolute -top-2 left-2 flex -translate-y-full items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
            <FileSearch className="h-3 w-3 shrink-0" />
            请先完成上方代码源授权，授权后将自动继续分析
          </div>
        )}
        <ChatTextarea
          value={input}
          disabled={disabled}
          onChange={handleInputChange}
          onKeyDown={stableChatKeydown}
          placeholder={placeholder}
          className={cn(
            "min-h-20 w-full resize-none bg-transparent px-1 text-xs outline-none",
            approvalBlocked && "cursor-not-allowed opacity-60"
          )}
        />
        <div className="flex items-center justify-between gap-1.5">
          {/* slot：ModelSelector / TokenMeter 由 WritingAssistant 注入 */}
          <div className="flex min-h-8 flex-1 items-center gap-1.5">{children}</div>
          <div className="flex shrink-0 items-center gap-1.5">
            {busy ? (
              <Button
                size="icon"
                variant="outline"
                title="停止生成"
                className="h-8 w-8 shrink-0 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50"
                onClick={onStop}
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-8 w-8"
                disabled={!input.trim() || approvalBlocked}
                onClick={() => void submit()}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const ChatComposer = memo(ChatComposerImpl);
```

> **搬迁注意**：`submit` 里 `busy || approvalBlocked` 合并为入参 `disabled`；`clearConversation` → `onClearConversation`；`sendText(text, forceSkillIds)` → `onSend({ text, snippetRefs: [], forceSkillIds })`。发送后 `setInput("")` + `setSlashForcedClosed(false)` 从 `sendText`（WritingAssistant L1958-1959）搬进 composer 的 submit（因 composer 拥有 input）。**历史记录（inputHistory.push）留在父级 onSend 实现**，不进 composer。

- [ ] **Step 2: 改 WritingAssistant.tsx — 删除已搬走的代码**

按搬迁来源清单删除：`ChatTextarea` memo（L1542-1571）、输入/斜杠 state（L1611/1618-1619/1638-1673）、`/api/ai/skills` fetch effect（L1643-1654）、`handleInputChange`/`chatKeydownRef`/`stableChatKeydown`（L1911-1925）、keydown effect（L2068-2128）、`slashSelect`（L2027-2036）、`submit`（L2038-2065）、输入区 JSX（L2505-2585）。

保留 `sendText`（L1955-1972）与 `clearConversation`（L1927-1952），但改造其调用方式（下一步）。

- [ ] **Step 3: 改 WritingAssistant.tsx — 加 onSend 适配器 + 渲染 ChatComposer**

`sendText` 改造为支持 refs 序列化（Task 7 用，本任务先加签名占位 `snippetRefs`/`messageOverride` 但不强制用）。在 `sendText`（L1955）处改为：

```ts
  /**
   * 发送一条普通消息。
   * - text：进 inputHistory（历史干净，不带标记）。
   * - messageOverride：实际发给 transport 的文本（@ 引用时为 serializeComposer 产出的带标记 message；缺省=text）。
   * - forceSkillIds：/skill 强制加载。
   */
  async function sendText(
    text: string,
    forceSkillIds?: string[],
    messageOverride?: string
  ) {
    if (!text || busy) return;
    await (onFlushTarget ?? onFlushArticle)?.();
    setInputHistory((prev) =>
      prev[prev.length - 1] === text ? prev : [...prev, text]
    );
    // input 清空已由 ChatComposer.submit 负责；此处不再 setInput
    await sendMessage(
      { text: messageOverride ?? text },
      {
        body: forceSkillIds?.length
          ? { ...requestBody, forceSkillIds }
          : requestBody,
      }
    );
  }
```

> 注意：原 `sendText` 里的 `setInput("")` / `setSlashForcedClosed(false)` 已搬入 ChatComposer.submit，此处删除。`historyIndex.current = null` 也搬入 composer（若 composer 拥有 historyIndex）——但 historyIndex 在 composer 内部，父级无法清。**接受历史索引在发送后不复位的小偏差**（不影响功能：下次上下键仍从最新开始），或在 onSend 后通过 key 重置 composer（本任务不做，留观察）。

在 WritingAssistant 的输入区位置（原 L2505-2585 删除处）渲染：

```tsx
      <ChatComposer
        disabled={approvalBlocked || busy}
        streaming={busy}
        approvalBlocked={approvalBlocked}
        placeholder={
          approvalBlocked
            ? "等待代码源授权…请在上方卡片选择「仅本会话允许」或「允许并长期信任」"
            : "让 Agent 研究、创作或调整文章…（输入 / 查看命令 · Enter 发送 · Shift+Enter 换行）"
        }
        inputHistory={inputHistory}
        onSend={({ text, snippetRefs, forceSkillIds }) => {
          if (snippetRefs.length) {
            const { message } = serializeComposer(text, snippetRefs);
            return sendText(text, forceSkillIds, message);
          }
          return sendText(text, forceSkillIds);
        }}
        onClearConversation={clearConversation}
        onStop={() => stop()}
      >
        <ModelSelector
          providers={providers}
          providerId={providerId}
          modelId={modelId}
          onSelect={selectModel}
        />
        <TokenMeter
          contextUsage={latestContextUsage}
          lastTurn={lastTurnUsage}
          modelName={
            providers.find((p) => p.id === providerId)?.models.find(
              (m) => m.id === modelId
            )?.name ?? modelId
          }
        />
      </ChatComposer>
```

顶部 import 加：
```ts
import { ChatComposer } from "./ChatComposer";
import { serializeComposer } from "@/lib/ai/snippet-serialize";
```

删除 WritingAssistant 中不再使用的 import（`SlashMenu`、`Send`、`Square`、`FileSearch`、slash-commands 命名导入中已搬走的等——按 typecheck 报错清理）。

- [ ] **Step 4: typecheck + build**

Run: `pnpm typecheck`
Expected: 通过（清理完未用 import 后）。

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 5: 回归手动验证（清单 A）**

`pnpm dev` 后在浏览器（带写作助手的页面）逐项验证：
- [ ] 输入 `/` 弹斜杠菜单；↑↓ 导航高亮移动；Enter/Tab 选中
- [ ] `/clear` 触发清空确认对话框（onClearConversation 链路）
- [ ] `/<skill>` 无正文时显示 slashNotice 提示；有正文时发送
- [ ] 首行 ↑ 回溯历史输入；末行 ↓ 前进；超出范围回到空
- [ ] `Enter` 发送；`Shift+Enter` 换行
- [ ] approval 锁定时输入禁用 + placeholder 切换 + 按钮禁用
- [ ] 流式时按钮变红色停止；点击可中断
- [ ] ModelSelector / TokenMeter 正常渲染在底栏

任一项失败 → 修到全绿再进 Task 6。

- [ ] **Step 6: Checkpoint**

报告改动 + 回归清单 A 结果（不 commit）。

---

## Task 6: SnippetMentionPopover + SnippetRefChip（组件，无单测）

**Files:**
- Create: `src/components/editor/SnippetMentionPopover.tsx`
- Create: `src/components/editor/SnippetRefChip.tsx`

**Interfaces:**
- Consumes: `SnippetSearchItem`（Task 1）、`SlashMenu` 的浮层样式范式（`slash-commands.tsx` L108-146）。
- Produces: `<SnippetMentionPopover items activeIndex onSelect />`、`<SnippetRefChip displayText color onDelete />`，供 Task 7 的 ChatComposer 消费。

- [ ] **Step 1: 创建 `src/components/editor/SnippetMentionPopover.tsx`**

```tsx
"use client";

import { Fragment } from "react";
import { Sparkles, Image as ImageIcon, Quote, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SnippetSearchItem } from "./at-commands";

function KindIcon({ kind }: { kind: string }) {
  if (kind === "image") return <ImageIcon className="h-3 w-3 text-muted-foreground" />;
  if (kind === "quote") return <Quote className="h-3 w-3 text-muted-foreground" />;
  if (kind === "link") return <LinkIcon className="h-3 w-3 text-muted-foreground" />;
  return null;
}

/** @ 触发的灵感检索浮动面板（镜像 SlashMenu 的浮层/键盘高亮/onMouseDown 防失焦）。 */
export function SnippetMentionPopover({
  items,
  activeIndex,
  loading,
  error,
  onRetry,
  onSelect,
}: {
  items: SnippetSearchItem[];
  activeIndex: number;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onSelect: (item: SnippetSearchItem) => void;
}) {
  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 max-h-72 w-80 overflow-y-auto rounded-lg border bg-background p-1 shadow-md">
      {loading && (
        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
          检索中…
        </div>
      )}
      {!loading && error && (
        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
          加载失败，<button type="button" className="text-primary underline" onClick={onRetry}>重试</button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
          未找到匹配的灵感
        </div>
      )}
      {!loading && !error && items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(item);
          }}
          className={cn(
            "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
            index === activeIndex && "bg-accent"
          )}
        >
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt=""
              className="mt-0.5 h-8 w-8 shrink-0 rounded object-cover"
            />
          ) : (
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <KindIcon kind={item.kind} />
              <span className="block truncate font-medium text-foreground">
                {item.title || item.summary.slice(0, 20)}
              </span>
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {item.summary}
            </span>
            {item.tags.length > 0 && (
              <span className="mt-0.5 block truncate text-[10px] text-primary/70">
                {item.tags.map((t) => `#${t}`).join(" ")}
              </span>
            )}
          </span>
        </button>
      ))}
      <div className="mt-0.5 border-t px-2 py-1 text-[10px] text-muted-foreground">
        ↑↓ 选择 · Tab/Enter 确认 · Esc 关闭
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 `src/components/editor/SnippetRefChip.tsx`**

```tsx
"use client";

import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** 托盘里的灵感引用 chip（不可编辑，× 可删）。 */
export function SnippetRefChip({
  displayText,
  color,
  onDelete,
}: {
  displayText: string;
  color: string | null;
  onDelete: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary",
        color && `bg-${color}/10 text-${color}-600`
      )}
    >
      <Sparkles className="h-3 w-3 shrink-0" />
      <span className="max-w-[12rem] truncate">{displayText}</span>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onDelete();
        }}
        aria-label={`移除引用 ${displayText}`}
        className="shrink-0 rounded-full hover:bg-primary/20"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: 通过。报告改动（不 commit）。

---

## Task 7: @接入 ChatComposer（state / keydown / fetch / 托盘 / 选中 / 序列化）

**Files:**
- Modify: `src/components/editor/ChatComposer.tsx`

**目标**：在 ChatComposer 内接入 `@` 触发 → `SnippetMentionPopover`（debounce fetch `/api/snippets/search`）→ 选中删触发文本 + 进托盘（`SnippetRefChip`）→ 发送时 onSend 带 `snippetRefs`（父级已接序列化，Task 5 Step 3 已就绪）。

- [ ] **Step 1: 改 ChatComposer.tsx — 加 import 与 @ state**

顶部 import 增加：
```ts
import { atQuery, filterSnippets, type SnippetSearchItem } from "./at-commands";
import { SnippetMentionPopover } from "./SnippetMentionPopover";
import { SnippetRefChip } from "./SnippetRefChip";
```

在斜杠 state 之后（`slashNotice` 之后）加 @ state：
```ts
  // ── @ 灵感引用 ──
  type SnippetRef = { id: string; displayText: string; color: string | null };
  const [snippetRefs, setSnippetRefs] = useState<SnippetRef[]>([]);
  const [atItems, setAtItems] = useState<SnippetSearchItem[]>([]);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [atLoading, setAtLoading] = useState(false);
  const [atError, setAtError] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const atResultRef = useRef<ReturnType<typeof atQuery>>(null);
```

- [ ] **Step 2: 改 ChatComposer.tsx — IME + 检测 + debounce fetch**

把 `ChatTextarea` 的渲染改为带 ref 与 composition 事件（替换 Task 5 里的 `<ChatTextarea … />` JSX）：

```tsx
        <ChatTextarea
          ref={textareaRef}
          value={input}
          disabled={disabled}
          onChange={handleInputChange}
          onKeyDown={stableChatKeydown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder={placeholder}
          className={cn(
            "min-h-20 w-full resize-none bg-transparent px-1 text-xs outline-none",
            approvalBlocked && "cursor-not-allowed opacity-60"
          )}
        />
```

`ChatTextarea` memo 组件需支持 ref —— 改其签名为 `forwardRef`：

```tsx
const ChatTextarea = memo(
  forwardRef<HTMLTextAreaElement, {
    value: string;
    disabled: boolean;
    placeholder: string;
    className: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onCompositionStart: () => void;
    onCompositionEnd: () => void;
  }>(function ChatTextarea(props, ref) {
    return <textarea ref={ref} {...props} />;
  })
);
```

在 `handleInputChange` 里追加检测（保留原逻辑）：
```ts
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      setSlashForcedClosed(false);
      const caret = e.target.selectionStart ?? e.target.value.length;
      atResultRef.current = atQuery(e.target.value, caret, isComposing);
      setAtActiveIndex(0);
    },
    [isComposing]
  );
```

加 debounce fetch effect（放在 keydown effect 之后）：
```ts
  // @ 面板检索：atResultRef 变化时 debounce 150ms fetch /api/snippets/search
  const atOpen = atResultRef.current !== null;
  useEffect(() => {
    if (!atOpen) {
      setAtItems([]);
      setAtError(false);
      return;
    }
    const q = atResultRef.current?.query ?? "";
    setAtLoading(true);
    setAtError(false);
    const timer = window.setTimeout(async () => {
      try {
        const url = `/api/snippets/search?limit=8${q ? `&q=${encodeURIComponent(q)}` : ""}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as { items: SnippetSearchItem[] };
        setAtItems(filterSnippets(data.items ?? [], q));
      } catch {
        setAtError(true);
      } finally {
        setAtLoading(false);
      }
    }, 150);
    return () => window.clearTimeout(timer);
    // atResultRef.current 每次输入变化，但 ref 不触发 effect；用 input+isComposing 作依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isComposing, atOpen]);
```

> **注**：`atResultRef.current` 是 ref，不触发重渲染。`atOpen` 在渲染期由 `atResultRef.current !== null` 计算并作为依赖，配合 `input` 变化触发 effect。这是可接受的近似（每次 input 变化都重算 atQuery，等价于在 change handler 里算）。

- [ ] **Step 3: 改 ChatComposer.tsx — 选中逻辑（删触发文本 + 进托盘去重）**

加 `selectSnippet`：
```ts
  function selectSnippet(item: SnippetSearchItem) {
    // 删 textarea 里 [triggerStart..triggerEnd] 的触发文本
    const r = atResultRef.current;
    const el = textareaRef.current;
    if (r && el) {
      const next = input.slice(0, r.triggerStart) + input.slice(r.triggerEnd);
      setInput(next);
      const newCaret = r.triggerStart;
      window.setTimeout(() => {
        el.focus();
        el.setSelectionRange(newCaret, newCaret);
      }, 0);
    }
    atResultRef.current = null;
    setAtItems([]);
    // 去重进托盘
    setSnippetRefs((prev) =>
      prev.some((s) => s.id === item.id)
        ? prev
        : [
            ...prev,
            {
              id: item.id,
              displayText: item.title || item.summary.slice(0, 20),
              color: item.color,
            },
          ]
    );
  }
```

- [ ] **Step 4: 改 ChatComposer.tsx — keydown 加 @ 分支**

在 keydown effect 的 `if (slashOpen) { … }` 之后加 `else if (atOpen) { … }`（互斥分支）：

```ts
      } else if (atOpen && !atLoading) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setAtActiveIndex((i) => Math.min(atItems.length - 1, i + 1));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setAtActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const item = atItems[atActiveIndex] ?? atItems[0];
          if (item) selectSnippet(item);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          atResultRef.current = null;
          setAtItems([]);
          return;
        }
      }
```

并在 `submit` 里把 refs 传出（普通消息分支）：
```ts
    onSend({ text, snippetRefs: snippetRefs.map((s) => s.id) });
    setInput("");
    setSlashForcedClosed(false);
    setSnippetRefs([]); // 发送后清空托盘
```

- [ ] **Step 5: 改 ChatComposer.tsx — 渲染 popover + 托盘**

在 `{slashOpen && <SlashMenu … />}` 之后加 popover：
```tsx
        {atOpen && (
          <SnippetMentionPopover
            items={atItems}
            activeIndex={atActiveIndex}
            loading={atLoading}
            error={atError}
            onRetry={() => {
              // 触发重算：setInput 触发 effect
              setInput((v) => v + "");
            }}
            onSelect={selectSnippet}
          />
        )}
```

在 `<ChatTextarea … />` 与底栏 `<div className="flex items-center justify-between">` 之间插入托盘：
```tsx
        {snippetRefs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-1.5">
            {snippetRefs.map((ref) => (
              <SnippetRefChip
                key={ref.id}
                displayText={ref.displayText}
                color={ref.color}
                onDelete={() =>
                  setSnippetRefs((prev) => prev.filter((s) => s.id !== ref.id))
                }
              />
            ))}
          </div>
        )}
```

- [ ] **Step 6: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 通过。

- [ ] **Step 7: 手动验证（清单 B）**

`pnpm dev` + `pnpm db:migrate`（确保 Snippet 表有数据；先在 `/snippets` 建几条），浏览器验证：
- [ ] 文中输入 `@` 弹检索面板；继续输入实时过滤
- [ ] **中文连续输入**（如「融入@产品」）不被弹层打断（IME 闸门）
- [ ] ↑↓ 导航；Enter/Tab 选中；Esc 关闭且保留 `@` 文本
- [ ] 选中后 `@`+部分 query 从 textarea 删除，chip 进托盘
- [ ] 托盘 chip × 可删；删到空托盘收起
- [ ] 同一素材二次选中不重复进托盘
- [ ] API 失败时面板显示「加载失败，重试」
- [ ] 无匹配时显示空态
- [ ] 发送后 inputHistory 记录 raw text（重新 ↑ 看到，无 `{{snippet:` 标记）
- [ ] **端到端**：agent 收到 `{{snippet:id}}` → 调 `load_snippets`（工具卡片显示「加载灵感素材」）→ 正文自然融入、无标记回显

任一项失败 → 修到全绿再进 Task 8。

- [ ] **Step 8: Checkpoint**

报告改动 + 清单 B 结果（不 commit）。

---

## Task 8: SnippetCard P0 打磨（多 tag / 键盘可达 / 删除确认）

**Files:**
- Modify: `src/components/snippets/SnippetCard.tsx`

- [ ] **Step 1: 改卡片操作按钮的显示策略（hover → focus-within）+ focus ring**

把外层 `<Card>`（当前 L54-61）的 `onMouseEnter/onMouseLeave` + `isHovered` 删除，改为 CSS `focus-within` 显示操作区。操作区 div（当前 L63-82）改为：

```tsx
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handlePin}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={snippet.pinned ? "取消置顶" : "置顶"}
          aria-label={snippet.pinned ? "取消置顶" : "置顶"}
        >
          <Pin className={cn("h-3.5 w-3.5", snippet.pinned && "text-primary fill-primary")} />
        </button>
        <button
          onClick={handleDelete}
          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="删除"
          aria-label="删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
```

外层 `<Card>` 加 `group` 类并移除 hover state：
```tsx
    <Card
      className={cn(
        "group relative p-4 transition-all hover:shadow-md cursor-default break-inside-avoid",
        snippet.pinned && "ring-1 ring-primary/30"
      )}
    >
```
删除组件内的 `const [isHovered, setIsHovered] = useState(false);` 与 Card 的 `onMouseEnter/onMouseLeave`。

- [ ] **Step 2: 改 handleDelete 加确认**

```ts
  const handleDelete = async () => {
    if (!window.confirm("确定删除这条灵感？删除后可在回收站找回。")) return;
    const res = await fetch(`/api/snippets/${snippet.id}`, { method: "DELETE" });
    if (res.ok) {
      onDeleted(snippet.id);
    }
  };
```

- [ ] **Step 3: 改底部显示全部 tag（不只 tags[0]）**

把底部标签区（当前 L134-139）改为：

```tsx
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
        {tags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {tags.slice(0, 3).map((t) => (
              <span key={t} className="text-primary/70">#{t}</span>
            ))}
            {tags.length > 3 && (
              <span className="text-muted-foreground">+{tags.length - 3}</span>
            )}
          </span>
        )}
        <span className="ml-auto">{formatRelativeTime(snippet.createdAt)}</span>
      </div>
```

- [ ] **Step 4: typecheck + build + 手动验证（清单 C-卡片）**

Run: `pnpm typecheck && pnpm build`
Expected: 通过。

`pnpm dev` → `/snippets`：
- [ ] 卡片显示全部 tag（>3 个时尾部 `+N`）
- [ ] 鼠标悬停显示操作按钮；Tab 聚焦到按钮也显示 + 有 focus ring
- [ ] 删除点击弹 confirm；取消不删；确认后卡片消失

- [ ] **Step 5: Checkpoint**

报告改动（不 commit）。

---

## Task 9: SnippetsView 搜索框接 API

**Files:**
- Modify: `src/components/snippets/SnippetsView.tsx`

- [ ] **Step 1: 改 SnippetsView — 加搜索 state + fetch + 输入框**

在组件顶部加搜索 state 与 handler（替换现有 `filteredSnippets` 的纯前端过滤为搜索结果优先）：

```tsx
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SnippetItem[] | null>(null);
  const [searching, setSearching] = useState(false);

  // 搜索框非空时用 API 结果；否则用本地筛选（kind/tag 在已加载集合内）
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/snippets?q=${encodeURIComponent(q)}&limit=100`);
        const data = (await res.json()) as { snippets: SnippetItem[] };
        setSearchResults(data.snippets ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const baseList = searchResults ?? snippets;
  const filteredSnippets = baseList.filter((s) => {
    if (searchResults) return true; // 已按 q 服务端筛过
    if (activeTag) {
      const tags: string[] = JSON.parse(s.tagsJson || "[]");
      if (!tags.includes(activeTag)) return false;
    }
    if (activeKind && s.kind !== activeKind) return false;
    return true;
  });
```

顶部加 `import { useEffect } from "react";`（如已有 useState 则合并）。

在类型筛选标签区（当前 L50-75）与创建框之间插入搜索框：

```tsx
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索灵感（标题 / 正文 / 标签）…"
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {searching && (
          <span className="text-xs text-muted-foreground">搜索中…</span>
        )}
      </div>
```

- [ ] **Step 2: typecheck + build + 手动验证（清单 C-搜索）**

Run: `pnpm typecheck && pnpm build`
Expected: 通过。

`pnpm dev` → `/snippets`：
- [ ] 输入关键词 → debounce 后列表更新为服务端结果
- [ ] 清空搜索框 → 恢复本地列表 + kind/tag 筛选生效
- [ ] 无结果时列表为空（SnippetList 空态；若 SnippetList 无空态，显示「未找到」——检查 SnippetList 实现，无则加一行）

- [ ] **Step 3: Checkpoint**

报告改动（不 commit）。

---

## Task 10: 全量构建 + 完整验证

**Files:** 无（验证 gate）

- [ ] **Step 1: 全套单测**

Run: `pnpm test`
Expected: 全绿（含 Task 1-4 新增 + 既有 40 个 unit 测试）。

- [ ] **Step 2: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 通过。

- [ ] **Step 3: lint**

Run: `pnpm lint`
Expected: 无 error（warning 可接受；新增文件的 `react-hooks/exhaustive-deps` 已在 Task 7 显式 disable）。

- [ ] **Step 4: 全量手动验证清单（A + B + C + D）**

按 spec §11 手动验证清单逐项跑：
- A（斜杠/历史/发送回归）
- B（@引用全链路）
- C（P0 打磨：多 tag / 键盘 / 删除确认 / 搜索）
- D（构建，已由 Step 1-3 覆盖）

任一项红 → 回对应 Task 修。

- [ ] **Step 5: 报告 + 等待提交指示**

报告全部改动文件清单 + 各清单结果。**不 commit**，等用户统一指示提交（或继续 P2）。

---

## Self-Review 结果

**1. Spec 覆盖**：
- §1 目标①（@ 主线）→ Task 1/2/3/4/6/7 ✓
- §1 目标②（ChatComposer 提取）→ Task 5 ✓
- §1 目标③（P0 打磨 4 项）→ Task 8（多 tag/键盘/删除确认）+ Task 9（搜索）✓
- §4 ChatComposer 边界/接口/IME → Task 5 + Task 7 ✓
- §5 数据流 9 步 → Task 7（①-⑧）+ Task 4（⑨ system prompt）✓
- §6 纯逻辑 TDD → Task 1/2/3/4 ✓
- §7 load_snippets + system prompt → Task 3/4 ✓
- §8 P0 → Task 8/9 ✓
- §9 边界（IME/debounce/dedup/空态/失败/Esc/角标）→ Task 7 覆盖 IME/debounce/dedup/空态/失败/Esc；**发送按钮 ✦N 角标未实现**（spec §8 列为「可」非必需，本轮略，已在此记录）。
- §10 风险缓解 → behavior-preserving（Task 5 回归清单 A）+ 手动验证 ✓
- §11 实现顺序 → Task 1-10 顺序与 spec §11 6 步对齐 ✓

**2. Placeholder 扫描**：无 TBD/TODO；Task 4 Step 1 的「先读文件确认消息拿法」是必要的前置阅读（已给出备选方案），非占位。

**3. 类型一致性**：
- `ComposerSendPayload` Task 5 定义、Task 7 消费（snippetRefs 字段）一致 ✓
- `SnippetSearchItem` Task 1 定义、Task 6/7 消费一致 ✓
- `serializeComposer(text, snippetRefs: string[])` Task 2 定义、Task 5 Step 3 调用一致 ✓
- `atQuery(input, caretPos, isComposing)` Task 1 定义、Task 7 调用一致 ✓
- `loadSnippetsTool` Task 3 定义、注册、测试断言（permission=allow, category=memory）一致 ✓
- **已知偏差**：spec §6.3 `category: "content"` → 改 `"memory"`（Global Constraints 已记录原因）✓

**4. 范围**：单一可执行计划，10 个任务各自有可验证交付物，符合一个 spec 的体量。
