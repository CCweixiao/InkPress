# 素材块 P3-AI（item 19：AI 摘要）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans（inline）按 task 执行。步骤用 `- [ ]` 复选框跟踪。**本项目约束：不自动 commit，全部任务完成、用户发话后一次性统一提交**——故各 task 不含 commit 步骤，仅以 typecheck / 测试 / build 作为完成 gate。

**Goal:** 创建/编辑素材块时异步生成一句话 `aiSummary`，供 @面板预览，替代机械 `content.slice` 截断。

**Architecture:** 纯逻辑层（decide/compose/normalize，vitest 覆盖）+ 服务端胶水（generateAiSummary 调 `getModel()`+`generateText`，generateAndSaveAiSummary load→生成→update，全程吞错）。POST/PATCH 路由用 Next 16 `after()` fire-and-forget 触发。AI 失败永不阻断创建/编辑。

**Tech Stack:** Next 16.2.9 App Router · Prisma 7 + better-sqlite3 · Vercel AI SDK v6（`ai@^6` + `@ai-sdk/anthropic@^3`）· vitest（env=node，`@`→`src` alias）。

**Spec:** `docs/superpowers/specs/2026-07-08-snippets-p3-ai-design.md`

## Global Constraints

- **不自动 commit**：全部 task 完成后由用户统一发话再提交（本项目既有约定，覆盖 skill 默认的 per-task commit）。
- **AI 失败永不阻断创建/编辑**：`generateAiSummary` / `generateAndSaveAiSummary` 全量 try/catch + warn 日志，失败留 `aiSummary=null`，消费者回落 `content.slice(0,80)`。
- **TDD 边界 = 纯逻辑**：`decideStrategy` / `composePromptInput` / `normalizeAiSummary` 用 vitest 覆盖；`generateText` 实调 / `after()` 接线 / API 路由不进 vitest，走 typecheck + build + 手测。
- **客户端 bundle 无 Node 依赖**：`ai-summary.ts` 仅服务端 import（`@/lib/db` prisma + `@/lib/ai/provider` + `ai`），任何 `"use client"` 模块不得 import 它。
- **AI 调用参数（verbatim）**：system prompt = `你是素材整理助手。用一句不超过 30 字的中文概括以下素材的核心，直接输出概括，不要前缀、不要引号、不要解释。`；`temperature: 0.3`；`maxOutputTokens: 60`；`maxRetries: 1`。
- **title 不变**：维持首行抽取（用户已确认），AI 只动 `aiSummary`。
- **normalizeAiSummary**：trim → 去成对首尾引号（`""` `""` `''` `''`）→ 截断 ≤40 字 → 空串返 `null`。
- **AI SDK v6 option 名**：用 `maxOutputTokens`（非 `maxTokens`），参考既有 `src/lib/ai/context-manager.ts:140-147`。

## Pre-flight

- 分支：从当前 `feat/snippets-p3-ux` 开 stacked 子分支 `feat/snippets-p3-ai`。

---

### Task 1: 纯逻辑层（decideStrategy / composePromptInput / normalizeAiSummary）+ vitest

**Files:**
- Create: `src/lib/snippets/ai-summary.ts`（先只放纯函数 + 类型 + 常量，胶水 Task 2 加）
- Test: `tests/unit/snippet-ai-summary.test.ts`

**Interfaces:**
- Produces（后续 task 依赖，签名 verbatim）:
  ```ts
  export type SnippetSummaryInput = {
    kind: string;
    content: string;
    quoteSource?: string | null;
    linkUrl?: string | null;
    linkTitle?: string | null;
    linkDescription?: string | null;
  };
  export type SummaryStrategy = "ai" | "copy" | "skip";
  export function decideStrategy(s: SnippetSummaryInput): SummaryStrategy;
  export function composePromptInput(s: SnippetSummaryInput): string;
  export function normalizeAiSummary(raw: string): string | null;
  ```

- [ ] **Step 1: 写失败测试** `tests/unit/snippet-ai-summary.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  composePromptInput,
  decideStrategy,
  normalizeAiSummary,
} from "@/lib/snippets/ai-summary";

describe("decideStrategy", () => {
  it("text 走 ai", () => {
    expect(decideStrategy({ kind: "text", content: "今天读到一篇好文章" })).toBe("ai");
  });
  it("quote 走 ai", () => {
    expect(
      decideStrategy({ kind: "quote", content: "保持简单", quoteSource: "某作者" })
    ).toBe("ai");
  });
  it("link 有 linkDescription 走 copy（优先级最高）", () => {
    expect(
      decideStrategy({
        kind: "link",
        content: "https://x.com",
        linkDescription: "一篇深度好文",
      })
    ).toBe("copy");
  });
  it("link 无 linkDescription 走 ai", () => {
    expect(decideStrategy({ kind: "link", content: "https://x.com" })).toBe("ai");
  });
  it("link 的 linkDescription 仅空白 走 ai", () => {
    expect(
      decideStrategy({ kind: "link", content: "https://x.com", linkDescription: "   " })
    ).toBe("ai");
  });
  it("image 一律 skip", () => {
    expect(decideStrategy({ kind: "image", content: "截图说明" })).toBe("skip");
  });
  it("text 过短（<3）走 skip", () => {
    expect(decideStrategy({ kind: "text", content: "ab" })).toBe("skip");
  });
  it("text 仅空白走 skip", () => {
    expect(decideStrategy({ kind: "text", content: "   " })).toBe("skip");
  });
});

describe("composePromptInput", () => {
  it("text 原样（截断 1000 内）", () => {
    expect(composePromptInput({ kind: "text", content: "正文内容" })).toBe("正文内容");
  });
  it("quote 附出处", () => {
    expect(
      composePromptInput({ kind: "quote", content: "保持简单", quoteSource: "某作者" })
    ).toBe("保持简单\n—— 某作者");
  });
  it("quote 无出处不追加", () => {
    expect(composePromptInput({ kind: "quote", content: "保持简单" })).toBe("保持简单");
  });
  it("link 附 linkTitle（优先于 linkUrl）", () => {
    expect(
      composePromptInput({
        kind: "link",
        content: "看这个",
        linkTitle: "标题",
        linkUrl: "https://x.com",
      })
    ).toBe("看这个\n链接：标题");
  });
  it("link 无 title 回落 linkUrl", () => {
    expect(
      composePromptInput({ kind: "link", content: "看这个", linkUrl: "https://x.com" })
    ).toBe("看这个\n链接：https://x.com");
  });
  it("超长内容截断到 1000 字", () => {
    const long = "a".repeat(2000);
    expect(composePromptInput({ kind: "text", content: long }).length).toBe(1000);
  });
});

describe("normalizeAiSummary", () => {
  it("普通文本 trim 后原样", () => {
    expect(normalizeAiSummary("  一句话摘要  ")).toBe("一句话摘要");
  });
  it("去成对中文双引号", () => {
    expect(normalizeAiSummary("“一句话摘要”")).toBe("一句话摘要");
  });
  it("去成对英文双引号", () => {
    expect(normalizeAiSummary('"一句话摘要"')).toBe("一句话摘要");
  });
  it("不成对引号保留", () => {
    expect(normalizeAiSummary('"一句话摘要')).toBe('"一句话摘要');
  });
  it("超长截断到 40 字", () => {
    expect(normalizeAiSummary("一".repeat(50)).length).toBe(40);
  });
  it("空串返 null", () => {
    expect(normalizeAiSummary("   ")).toBeNull();
  });
  it("空串（去引号后）返 null", () => {
    expect(normalizeAiSummary('""')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm vitest run tests/unit/snippet-ai-summary.test.ts`
Expected: FAIL（模块不存在 / 函数未导出）。

- [ ] **Step 3: 实现纯逻辑** `src/lib/snippets/ai-summary.ts`（本 task 仅以下内容，胶水 Task 2 追加；**本 task 不 import moduleLogger / 不声明 log**，Task 2 再引入）

```ts
/** 送入摘要决策的最小字段集（结构兼容 prisma Snippet，多出的字段无碍）。 */
export type SnippetSummaryInput = {
  kind: string;
  content: string;
  quoteSource?: string | null;
  linkUrl?: string | null;
  linkTitle?: string | null;
  linkDescription?: string | null;
};

export type SummaryStrategy = "ai" | "copy" | "skip";

/** 生成 system prompt（verbatim，被 Task 2 的 generateAiSummary 复用）。 */
export const AI_SUMMARY_SYSTEM =
  "你是素材整理助手。用一句不超过 30 字的中文概括以下素材的核心，直接输出概括，不要前缀、不要引号、不要解释。";

/** 输入截断上限，防超长 prompt。 */
const PROMPT_MAX_CHARS = 1000;

/** 摘要最大字数（normalize 后）。 */
const SUMMARY_MAX_CHARS = 40;

/**
 * 决策生成策略（按优先级）：
 * 1. link 且有非空 linkDescription → "copy"（直接用 OG 描述，零 AI 调用）
 * 2. image → "skip"（caption 由 content.slice 兜底）
 * 3. content 过短（<3）→ "skip"
 * 4. 其他（text/quote/无 OG 的 link）→ "ai"
 */
export function decideStrategy(s: SnippetSummaryInput): SummaryStrategy {
  if (s.kind === "link" && (s.linkDescription ?? "").trim()) return "copy";
  if (s.kind === "image") return "skip";
  if (s.content.trim().length < 3) return "skip";
  return "ai";
}

/** 拼装送给 LLM 的正文（按 kind 附加上下文），截断到 PROMPT_MAX_CHARS。 */
export function composePromptInput(s: SnippetSummaryInput): string {
  const parts: string[] = [s.content];
  if (s.kind === "quote") {
    const src = (s.quoteSource ?? "").trim();
    if (src) parts.push(`—— ${src}`);
  }
  if (s.kind === "link") {
    const where = (s.linkTitle ?? s.linkUrl ?? "").trim();
    if (where) parts.push(`链接：${where}`);
  }
  return parts.join("\n").slice(0, PROMPT_MAX_CHARS);
}

/** 成对首尾引号（中/英、双/单）。 */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["“", "”"], // 中文双引号 “ ”
  ['"', '"'], // 英文双引号
  ["‘", "’"], // 中文单引号 ‘ ’
  ["'", "'"], // 英文单引号
];

/** trim → 去成对首尾引号 → 截断 ≤40 字 → 空串返 null。 */
export function normalizeAiSummary(raw: string): string | null {
  let t = (raw ?? "").trim();
  if (!t) return null;
  for (const [open, close] of QUOTE_PAIRS) {
    if (t.length >= 2 && t[0] === open && t[t.length - 1] === close) {
      t = t.slice(1, -1).trim();
      break;
    }
  }
  if (!t) return null;
  return t.slice(0, SUMMARY_MAX_CHARS);
}
```

> 说明：`void log;` 仅占位避免「未使用 import」告警，Task 2 会用到 `log`，届时删掉该行。若 Task 1 typecheck 报 unused，保留 `void log;` 即可过。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm vitest run tests/unit/snippet-ai-summary.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`（或 `pnpm exec tsc --noEmit`）
Expected: 0 error。

---

### Task 2: 服务端胶水（generateAiSummary / generateAndSaveAiSummary）+ POST 路由接线

**Files:**
- Modify: `src/lib/snippets/ai-summary.ts`（追加胶水；删去 Task 1 的 `void log;`）
- Modify: `src/app/api/snippets/route.ts`（POST：创建后 `after()` 触发）

**Interfaces:**
- Consumes（来自 Task 1）: `decideStrategy`, `composePromptInput`, `normalizeAiSummary`, `AI_SUMMARY_SYSTEM`, `SnippetSummaryInput`
- Consumes（外部）: `getModel` from `@/lib/ai/provider`（返回 `{model, config}`）、`generateText` from `"ai"`、`prisma` from `@/lib/db`、`after` from `next/server`
- Produces:
  ```ts
  export async function generateAiSummary(s: SnippetSummaryInput): Promise<string | null>;
  export async function generateAndSaveAiSummary(snippetId: string): Promise<void>;
  ```

- [ ] **Step 1: 追加胶水到 `src/lib/snippets/ai-summary.ts`**

在文件顶部 import 区追加 3 个服务端依赖，并在 import 之后、纯函数之前声明 logger：

```ts
import { generateText } from "ai";
import { moduleLogger } from "@/lib/logger";
import { getModel } from "@/lib/ai/provider";
import { prisma } from "@/lib/db";

const log = moduleLogger("snippets.ai-summary");
```

然后在文件末尾追加胶水实现：

```ts
/**
 * 生成单条素材的 aiSummary。
 * - "skip" → null（不调 AI）
 * - "copy" → normalize(linkDescription)
 * - "ai"   → getModel + generateText（temperature 0.3 / maxOutputTokens 60 / maxRetries 1）
 * 全程吞错：失败返 null，由调用方决定是否写回（留空则消费者回落 content.slice）。
 */
export async function generateAiSummary(
  s: SnippetSummaryInput
): Promise<string | null> {
  const strategy = decideStrategy(s);
  if (strategy === "skip") return null;
  if (strategy === "copy") return normalizeAiSummary((s.linkDescription ?? ""));
  try {
    const { model } = await getModel();
    const prompt = composePromptInput(s);
    const { text } = await generateText({
      model,
      system: AI_SUMMARY_SYSTEM,
      prompt,
      temperature: 0.3,
      maxOutputTokens: 60,
      maxRetries: 1,
    });
    return normalizeAiSummary(text);
  } catch (e) {
    log.warn({ err: e, kind: s.kind }, "生成 aiSummary 失败（留空回落 content.slice）");
    return null;
  }
}

/**
 * 加载 → 生成 → 写回 aiSummary。fire-and-forget 入口（由 POST/PATCH 的 after() 调用）。
 * 全程吞错：任何异常只 warn，不影响已返回的 201/200。
 */
export async function generateAndSaveAiSummary(
  snippetId: string
): Promise<void> {
  try {
    const s = await prisma.snippet.findUnique({ where: { id: snippetId } });
    if (!s) return;
    const aiSummary = await generateAiSummary(s);
    if (aiSummary === null) return;
    await prisma.snippet.update({
      where: { id: snippetId },
      data: { aiSummary },
    });
  } catch (e) {
    log.warn({ err: e, snippetId }, "generateAndSaveAiSummary 失败（不阻断）");
  }
}
```

> import 顺序按既有文件风格（参考 `src/app/api/ai/chat/route.ts`）：外部包（`"ai"`）在前，`@/lib/*` 在后。

- [ ] **Step 2: POST 路由接线** `src/app/api/snippets/route.ts`

顶部 import 追加：
```ts
import { after } from "next/server";
import { generateAndSaveAiSummary } from "@/lib/snippets/ai-summary";
```

POST handler 末尾（`prisma.snippet.create` 之后、return 之前）追加 `after(...)`：
```ts
  const snippet = await prisma.snippet.create({
    data: {
      ...data,
      title,
      tagsJson: JSON.stringify(tags),
    },
  });

  // 异步生成 aiSummary（@面板预览用）。fire-and-forget，失败不阻断创建。
  after(() => generateAndSaveAiSummary(snippet.id));

  return NextResponse.json({ snippet }, { status: 201 });
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: 0 error。

- [ ] **Step 4: build**

Run: `pnpm build`
Expected: ✓ Compiled successfully（无 client bundle 把 prisma 拉进 `"use client"` 的告警）。

- [ ] **Step 5: 单测回归**

Run: `pnpm vitest run`
Expected: 全部既有用例 + Task 1 新增用例 PASS（确认胶水追加未破坏纯函数导出）。

- [ ] **Step 6: 手测（需配置 AI 供应商）**

1. 启动 dev：`pnpm dev`，打开 `/snippets`。
2. 创建一条 text 素材「今天读到一篇关于 React Server Components 的深度分析，核心观点是……」。
3. 等待 ~2-5s，刷新列表 / 切换标签触发 re-fetch。
4. 打开任意文章编辑器的 @面板，搜索该条 → `summary` 应为 AI 一句话概括（非前 80 字截断）。
5. 未配置供应商时：创建仍成功，aiSummary 留空，@面板显示 content 截断（不报错）。

---

### Task 3: PATCH 路由接线（编辑时按字段变化重新生成）

**Files:**
- Modify: `src/app/api/snippets/[id]/route.ts`（PATCH：检测输入字段变化 → `after()`）

**Interfaces:**
- Consumes: `generateAndSaveAiSummary` from `@/lib/snippets/ai-summary`、`after` from `next/server`
- 触发字段（任一相对旧值变化才触发）：`content` / `kind` / `quoteSource` / `linkTitle` / `linkDescription`

- [ ] **Step 1: PATCH 路由接线** `src/app/api/snippets/[id]/route.ts`

顶部 import 追加：
```ts
import { after } from "next/server";
import { generateAndSaveAiSummary } from "@/lib/snippets/ai-summary";
```

PATCH handler：在 `prisma.snippet.update` 之后、return 之前，插入字段变化检测 + `after(...)`。注意 `existing` 已在路由内 `findUnique` 取得，`rest` 为 `parsed.data` 去掉 `tags` 后的字段集合（各字段 `T | undefined`，未提供即 undefined）：

```ts
  const snippet = await prisma.snippet.update({ where: { id }, data });

  // 输入字段变化时异步重生成 aiSummary；只改 tag/color/pinned 等不触发。
  const inputChanged =
    (rest.content !== undefined && rest.content !== existing.content) ||
    (rest.kind !== undefined && rest.kind !== existing.kind) ||
    (rest.quoteSource !== undefined &&
      (rest.quoteSource ?? null) !== existing.quoteSource) ||
    (rest.linkTitle !== undefined &&
      (rest.linkTitle ?? null) !== existing.linkTitle) ||
    (rest.linkDescription !== undefined &&
      (rest.linkDescription ?? null) !== existing.linkDescription);
  if (inputChanged) {
    after(() => generateAndSaveAiSummary(id));
  }

  return NextResponse.json({ snippet });
```

> 现有 PATCH handler 的解构为 `const { tags, ...rest } = parsed.data;`，`rest` 即上述引用。若实际变量名不同，按当前文件调整。

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 0 error。

- [ ] **Step 3: build**

Run: `pnpm build`
Expected: ✓ Compiled successfully。

- [ ] **Step 4: 手测**

1. 编辑既有 text 素材的 content（改内容）→ 等几秒刷新 → @面板该条 summary 更新。
2. 编辑既有素材**只改标签** → summary 不变（不触发重生成）。
3. 把 text 素材的 link 填入 linkDescription（变成有 OG 的 link）→ 触发后 summary 变为 linkDescription（copy 策略）。

---

## Self-Review

**1. Spec coverage：**
- AI 只生成 aiSummary、title 不变 → Task 2/3 只动 aiSummary，无 title 写入 ✓
- 异步 after() → Task 2 (POST) + Task 3 (PATCH) ✓
- 跳过策略（link+OG=copy / image=skip / 短文本=skip / 其他=ai）→ Task 1 decideStrategy 测试全分支 ✓
- composePromptInput（text/quote/link）→ Task 1 测试 ✓
- normalize（trim/引号/截断/空→null）→ Task 1 测试 ✓
- 错误吞掉、不阻断 → Task 2 generateAiSummary/generateAndSaveAiSummary 双层 try/catch ✓
- 触发字段（content/kind/quoteSource/linkTitle/linkDescription）→ Task 3 inputChanged ✓

**2. Placeholder 扫描：** 无 TBD/TODO；所有 prompt/阈值/签名均 verbatim（system prompt、temp 0.3、maxOutputTokens 60、maxRetries 1、PROMPT_MAX_CHARS 1000、SUMMARY_MAX_CHARS 40）。

**3. 类型一致性：** `SnippetSummaryInput` 在 Task 1 定义，Task 2 `generateAiSummary(s: SnippetSummaryInput)` 复用；`generateAndSaveAiSummary` 传入 prisma `Snippet`（结构兼容，多字段无碍）。`SummaryStrategy = "ai"|"copy"|"skip"` 在 decideStrategy 返回、generateAiSummary 消费，字面量一致。

**4. AI SDK v6 option 名：** `maxOutputTokens`（非 `maxTokens`），与 `src/lib/ai/context-manager.ts:145` 一致 ✓。

**5. 客户端安全：** `ai-summary.ts` 顶部 import `@/lib/db`(prisma) + `ai` + `@/lib/ai/provider`，仅被 server route 文件 import；无 `"use client"` 链路拉入 ✓。

## Execution Handoff

Plan 完成并落盘 `docs/superpowers/plans/2026-07-08-snippets-p3-ai.md`。

两种执行方式：
1. **Inline Execution（推荐）** —— 本 session 内用 executing-plans 顺序跑 Task 1→2→3，与本项目「不自动 commit、统一收尾提交」约定兼容。
2. Subagent-Driven —— 每 task 派子 agent + 评审；但其 per-task commit 机制与本项目 no-commit 约定冲突，不推荐。

**选哪种？**（推荐 Inline）
