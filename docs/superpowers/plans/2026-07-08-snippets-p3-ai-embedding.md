# 素材块 P3-AI（item 20：embedding 语义检索）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans（inline）按 task 执行。步骤用 `- [ ]` 复选框跟踪。**本项目约束：不自动 commit，全部任务完成、用户发话后一次性统一提交**——故各 task 不含 commit 步骤，仅以 typecheck / 测试 / build / lint 作为完成 gate。

**Goal:** 为素材块生成语义向量，让 @面板与 /snippets 主搜索框支持语义召回；未配置或无向量时回落子串，零回归。

**Architecture:** 纯逻辑层（parseEmbeddingConfig / composeEmbeddingInput / mergeKeywordAndSemantic，vitest）+ 服务端胶水（getEmbeddingConfig 读加密信封 / embedText 原生 fetch / generateAndSaveEmbedding / findSemanticSnippets 用 ai 包 cosineSimilarity）。生成走 POST/PATCH 的 `after()`（与 item19 aiSummary 并列）。检索在两个 GET 路由合并 keyword+semantic。`inkpress.embedding` 注册到 `config-secrets` + `system-config` 路由（仿 OSS/WebResearch）。客户端隔离：GET findMany `omit:{embedding:true}` + types.ts 删字段。

**Tech Stack:** Next 16.2.9 · Prisma 7（`omit` GA）· `ai@^6`（内置 `cosineSimilarity`）· vitest。

**Spec:** `docs/superpowers/specs/2026-07-08-snippets-p3-ai-embedding-design.md`

## Global Constraints

- **不自动 commit**：全部 task 完成后由用户统一发话再提交（覆盖 skill 默认 per-task commit）。
- **未配置 / 失败 / 无向量 → 永不阻断、回落子串**：embedText / generateAndSaveEmbedding / findSemanticSnippets 全量 try/catch + warn，返 `null`/`[]`。
- **TDD 边界 = 纯逻辑**：`parseEmbeddingConfig` / `composeEmbeddingInput` / `mergeKeywordAndSemantic` 进 vitest；fetch / cosineSimilarity / 路由 / 表单 / backfill 走 typecheck + build + 手测。
- **客户端 bundle 无 Node 依赖**：`embedding-config.ts` / `embedding.ts` / `semantic-search.ts` 仅服务端 import（prisma + fetch），不进 `"use client"` 链路。
- **客户端隔离**：`/api/snippets` GET 的 findMany 加 `omit:{embedding:true}`；`types.ts` 删 `embedding` 字段。`/api/snippets/search` 已用 select 不含 embedding（不动）。
- **加密信封一致性**：`inkpress.embedding` 必须同时注册到 `config-secrets.ts` 的 `CONFIG_SECRET_FIELDS`（写加密 + 读解密都走它），否则 apiKey 存密文读明文/反之。
- **关键字 verbatim**：维度 `[256,512,1024,2048]`、默认 `1024`、默认 baseUrl `https://open.bigmodel.cn/api/paas/v4`、默认 model `embedding-3`、threshold `0.30`、topK `20`、输入截断 `1000` 字、embedText 超时 `15000ms`。
- **after() 共用**：POST/PATCH 的 `after()` 同时跑 aiSummary 与 embedding（`void generateAndSaveAiSummary(id); void generateAndSaveEmbedding(id);`），各自独立 try/catch。
- **backfill 不入 entrypoint**：`scripts/backfill-embeddings.ts` 手动 `pnpm tsx` 跑。

## Pre-flight

- 分支：从当前 `feat/snippets-p3-ai` 开 stacked 子分支 `feat/snippets-p3-embedding`。

---

### Task 1: 纯逻辑层（parseEmbeddingConfig / composeEmbeddingInput / mergeKeywordAndSemantic）+ vitest

**Files:**
- Create: `src/lib/ai/embedding-config.ts`（仅常量 + 类型 + `parseEmbeddingConfig`，不 import prisma/decrypt）
- Create: `src/lib/snippets/embedding.ts`（仅 `composeEmbeddingInput` + 类型，不 import fetch/prisma）
- Create: `src/lib/snippets/semantic-search.ts`（仅 `mergeKeywordAndSemantic` + 类型）
- Test: `tests/unit/snippet-embedding.test.ts`

**Interfaces:**
- Produces（后续 task 依赖，签名 verbatim）:
  ```ts
  // embedding-config.ts
  export const EMBEDDING_CONFIG_KEY = "inkpress.embedding";
  export const EMBEDDING_DIMENSIONS = [256, 512, 1024, 2048] as const;
  export type EmbeddingDimensions = (typeof EMBEDDING_DIMENSIONS)[number];
  export type EmbeddingConfig = { baseUrl: string; apiKey: string; model: string; dimensions: EmbeddingDimensions };
  export const DEFAULT_EMBEDDING_CONFIG: { baseUrl: string; model: string; dimensions: EmbeddingDimensions };
  export function parseEmbeddingConfig(value: string): EmbeddingConfig;

  // embedding.ts
  export type SnippetEmbeddingInput = { kind: string; content: string; quoteSource?: string | null; linkTitle?: string | null; linkDescription?: string | null };
  export function composeEmbeddingInput(s: SnippetEmbeddingInput): string;

  // semantic-search.ts
  export type SemanticHit = { id: string; score: number };
  export function mergeKeywordAndSemantic<T extends { id: string }>(keywordSnippets: T[], semanticSnippets: T[], semanticScores: Record<string, number>, limit: number): T[];
  ```

- [ ] **Step 1: 写失败测试** `tests/unit/snippet-embedding.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMBEDDING_CONFIG,
  parseEmbeddingConfig,
} from "@/lib/ai/embedding-config";
import { composeEmbeddingInput } from "@/lib/snippets/embedding";
import { mergeKeywordAndSemantic } from "@/lib/snippets/semantic-search";

describe("parseEmbeddingConfig", () => {
  it("完整配置原样解析（baseUrl 去尾斜杠）", () => {
    const c = parseEmbeddingConfig(
      JSON.stringify({
        baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
        apiKey: "sk-1",
        model: "embedding-3",
        dimensions: 1024,
      })
    );
    expect(c).toEqual({
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: "sk-1",
      model: "embedding-3",
      dimensions: 1024,
    });
  });
  it("缺 dimensions 回落默认 1024", () => {
    const c = parseEmbeddingConfig(JSON.stringify({ baseUrl: "https://x", apiKey: "k" }));
    expect(c.dimensions).toBe(1024);
    expect(c.model).toBe(DEFAULT_EMBEDDING_CONFIG.model);
  });
  it("非法 dimensions 回落 1024", () => {
    const c = parseEmbeddingConfig(
      JSON.stringify({ baseUrl: "https://x", apiKey: "k", dimensions: 1337 })
    );
    expect(c.dimensions).toBe(1024);
  });
  it("合法的低维度 256/512/2048 保留", () => {
    for (const d of [256, 512, 2048] as const) {
      const c = parseEmbeddingConfig(
        JSON.stringify({ baseUrl: "https://x", apiKey: "k", dimensions: d })
      );
      expect(c.dimensions).toBe(d);
    }
  });
  it("缺 baseUrl 抛错", () => {
    expect(() => parseEmbeddingConfig(JSON.stringify({ apiKey: "k" }))).toThrow();
  });
  it("缺 apiKey 抛错", () => {
    expect(() => parseEmbeddingConfig(JSON.stringify({ baseUrl: "https://x" }))).toThrow();
  });
});

describe("composeEmbeddingInput", () => {
  it("text 原样", () => {
    expect(composeEmbeddingInput({ kind: "text", content: "正文" })).toBe("正文");
  });
  it("quote 附出处", () => {
    expect(
      composeEmbeddingInput({ kind: "quote", content: "保持简单", quoteSource: "某作者" })
    ).toBe("保持简单\n—— 某作者");
  });
  it("quote 无出处不追加", () => {
    expect(composeEmbeddingInput({ kind: "quote", content: "保持简单" })).toBe("保持简单");
  });
  it("link 附 title + description（空段不追加）", () => {
    expect(
      composeEmbeddingInput({
        kind: "link",
        content: "看这个",
        linkTitle: "标题",
        linkDescription: "描述",
      })
    ).toBe("看这个\n标题\n描述");
  });
  it("link 无 title/desc 只剩 content", () => {
    expect(composeEmbeddingInput({ kind: "link", content: "看这个" })).toBe("看这个");
  });
  it("image 用 caption", () => {
    expect(composeEmbeddingInput({ kind: "image", content: "截图说明" })).toBe("截图说明");
  });
  it("短文本（<3）返空串", () => {
    expect(composeEmbeddingInput({ kind: "text", content: "ab" })).toBe("");
  });
  it("超长截断到 1000 字", () => {
    expect(composeEmbeddingInput({ kind: "text", content: "a".repeat(2000) }).length).toBe(1000);
  });
});

describe("mergeKeywordAndSemantic", () => {
  const kw = (ids: string[]) => ids.map((id) => ({ id }));
  it("纯 keyword 原样返回", () => {
    expect(mergeKeywordAndSemantic(kw(["a", "b"]), [], {}, 10)).toEqual(kw(["a", "b"]));
  });
  it("纯 semantic 按 score 降序", () => {
    const sem = kw(["b", "c"]);
    const scores = { b: 0.5, c: 0.9 };
    expect(mergeKeywordAndSemantic([], sem, scores, 10)).toEqual(kw(["c", "b"]));
  });
  it("keyword 优先 + semantic 补充，去重", () => {
    const sem = kw(["a", "c"]); // a 同时命中 keyword
    const scores = { a: 0.99, c: 0.4 };
    expect(mergeKeywordAndSemantic(kw(["a", "b"]), sem, scores, 10)).toEqual(kw(["a", "b", "c"]));
  });
  it("limit 截断", () => {
    const sem = kw(["c", "d", "e"]);
    const scores = { c: 0.5, d: 0.4, e: 0.3 };
    expect(mergeKeywordAndSemantic(kw(["a", "b"]), sem, scores, 3)).toEqual(kw(["a", "b", "c"]));
  });
  it("semantic hit 无对应 snippet 则跳过", () => {
    const scores = { z: 0.9 }; // z 不在 semanticSnippets
    expect(mergeKeywordAndSemantic(kw(["a"]), [], scores, 10)).toEqual(kw(["a"]));
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm vitest run tests/unit/snippet-embedding.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/ai/embedding-config.ts`**（仅以下内容，不 import prisma/secret-store）

```ts
import { parseJsonObjectOrArrayConfig } from "@/lib/system-config";

export const EMBEDDING_CONFIG_KEY = "inkpress.embedding";

export const EMBEDDING_DIMENSIONS = [256, 512, 1024, 2048] as const;
export type EmbeddingDimensions = (typeof EMBEDDING_DIMENSIONS)[number];

export type EmbeddingConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: EmbeddingDimensions;
};

/** 智谱 OpenAI 兼容 embedding 端点默认值（设置表单预填）。 */
export const DEFAULT_EMBEDDING_CONFIG = {
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  model: "embedding-3",
  dimensions: 1024 as EmbeddingDimensions,
};

function readString(obj: Record<string, unknown>, fields: string[]): string {
  for (const f of fields) {
    const v = obj[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * 解析 embedding 配置 JSON（与 llm-config 同款校验风格，被 system-config 路由复用）。
 * - baseUrl 去尾斜杠；apiKey 必填；model 缺省 embedding-3。
 * - dimensions 缺省/非法（非 256/512/1024/2048）回落 1024。
 */
export function parseEmbeddingConfig(value: string): EmbeddingConfig {
  const raw = parseJsonObjectOrArrayConfig(value, "embedding 配置");
  const obj = (
    Array.isArray(raw) ? (raw[0] ?? {}) : raw
  ) as Record<string, unknown>;
  const baseUrl = readString(obj, ["baseUrl", "baseURL", "endpoint"]).replace(/\/+$/, "");
  const apiKey = readString(obj, ["apiKey", "key", "token"]);
  const model = readString(obj, ["model", "modelName"]) || DEFAULT_EMBEDDING_CONFIG.model;
  const dimsRaw = Number(obj.dimensions);
  const dimensions = (EMBEDDING_DIMENSIONS as readonly number[]).includes(dimsRaw)
    ? (dimsRaw as EmbeddingDimensions)
    : DEFAULT_EMBEDDING_CONFIG.dimensions;
  const missing = [!baseUrl && "baseUrl", !apiKey && "apiKey"].filter(Boolean);
  if (missing.length) throw new Error(`embedding 配置缺少字段：${missing.join(", ")}。`);
  return { baseUrl, apiKey, model, dimensions };
}
```

- [ ] **Step 4: 实现 `src/lib/snippets/embedding.ts`**（仅以下内容，不 import fetch/prisma）

```ts
/** 送入 embedding 的最小字段集（结构兼容 prisma Snippet）。 */
export type SnippetEmbeddingInput = {
  kind: string;
  content: string;
  quoteSource?: string | null;
  linkTitle?: string | null;
  linkDescription?: string | null;
};

const EMBEDDING_MAX_CHARS = 1000;

/**
 * 拼装 embedding 输入（按 kind 附加上下文），截断 ≤1000 字。
 * trim 后 <3 字返空串（调用方据此跳过 embed）。
 */
export function composeEmbeddingInput(s: SnippetEmbeddingInput): string {
  const parts: string[] = [s.content];
  if (s.kind === "quote") {
    const src = (s.quoteSource ?? "").trim();
    if (src) parts.push(`—— ${src}`);
  }
  if (s.kind === "link") {
    const title = (s.linkTitle ?? "").trim();
    const desc = (s.linkDescription ?? "").trim();
    if (title) parts.push(title);
    if (desc) parts.push(desc);
  }
  const joined = parts.join("\n").slice(0, EMBEDDING_MAX_CHARS);
  return joined.trim().length < 3 ? "" : joined;
}
```

- [ ] **Step 5: 实现 `src/lib/snippets/semantic-search.ts`**（仅以下内容）

```ts
/** 单条语义命中（id + 余弦分）。 */
export type SemanticHit = { id: string; score: number };

/**
 * 合并 keyword 命中与 semantic 命中：
 * - keyword 优先，保留原序
 * - semantic 中不在 keyword 集合的，按 score 降序追加
 * - 按 id 去重，semantic hit 无对应 snippet 则跳过
 * - 截断到 limit
 * 纯函数（cosine 已在上游算好），vitest 覆盖。
 */
export function mergeKeywordAndSemantic<T extends { id: string }>(
  keywordSnippets: T[],
  semanticSnippets: T[],
  semanticScores: Record<string, number>,
  limit: number
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const s of keywordSnippets) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    result.push(s);
  }
  const byId = new Map(semanticSnippets.map((s) => [s.id, s]));
  const sortedIds = Object.entries(semanticScores)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  for (const id of sortedIds) {
    if (result.length >= limit) break;
    if (seen.has(id)) continue;
    const s = byId.get(id);
    if (!s) continue;
    seen.add(id);
    result.push(s);
  }
  return result.slice(0, limit);
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `pnpm vitest run tests/unit/snippet-embedding.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 7: typecheck**

Run: `pnpm typecheck`
Expected: 0 error。

---

### Task 2: 注册 `inkpress.embedding` 到加密信封 + system-config 路由

**Files:**
- Modify: `src/lib/config-secrets.ts`（`CONFIG_SECRET_FIELDS` 加一行）
- Modify: `src/app/api/system-config/route.ts`（validateConfigValue / maskConfigs / PUT key-list / mergeMaskedSecrets 四处）

**Interfaces:**
- Consumes: `EMBEDDING_CONFIG_KEY`, `parseEmbeddingConfig` from `@/lib/ai/embedding-config`（Task 1）

- [ ] **Step 1: `src/lib/config-secrets.ts` 注册密钥字段**

在 `CONFIG_SECRET_FIELDS` 对象里追加一行（与 `inkpress.wechat` 同级）：
```ts
  "inkpress.wechat": [["secret"]],
  "inkpress.embedding": [["apiKey"]], // 新增
```

- [ ] **Step 2: `src/app/api/system-config/route.ts` — import**

顶部 import 区追加：
```ts
import {
  EMBEDDING_CONFIG_KEY,
  parseEmbeddingConfig,
} from "@/lib/ai/embedding-config";
```

- [ ] **Step 3: `validateConfigValue` 加分支**

在 `if (key === I18N_CONFIG_KEY) parseI18nConfig(value);` 之后、`else parseJsonObjectOrArrayConfig(value);` 之前插入：
```ts
  else if (key === EMBEDDING_CONFIG_KEY) parseEmbeddingConfig(value);
```

- [ ] **Step 4: `maskConfigs` 加分支**（仿 OSS/WebResearch flat-object 模式，mask apiKey）

在 `if (item.key === WECHAT_CONFIG_KEY) { ... }` 块之后追加：
```ts
    if (item.key === EMBEDDING_CONFIG_KEY) {
      try {
        const parsed = JSON.parse(item.value) as Record<string, unknown>;
        return {
          ...item,
          value: JSON.stringify(
            {
              ...parsed,
              apiKey:
                typeof parsed.apiKey === "string" && parsed.apiKey
                  ? "********"
                  : "",
            },
            null,
            2
          ),
        };
      } catch {
        return item;
      }
    }
```

- [ ] **Step 5: PUT 处理器的 `mergeMaskedSecrets` key 白名单加 EMBEDDING_CONFIG_KEY**

在 PUT handler 的 `if (parsed.data.key === LLM_CONFIG_KEY || ... || parsed.data.key === WECHAT_CONFIG_KEY)` 条件里追加 `|| parsed.data.key === EMBEDDING_CONFIG_KEY`。

- [ ] **Step 6: `mergeMaskedSecrets` 加 embedding 分支**（仿 WebResearch flat 单字段）

在 `mergeMaskedSecrets` 函数内、WebResearch 分支之后追加：
```ts
    if (key === EMBEDDING_CONFIG_KEY) {
      if (newVal.apiKey === "********" || newVal.apiKey === "") {
        newVal.apiKey = oldVal.apiKey ?? "";
      }
      return JSON.stringify(newVal, null, 2);
    }
```

- [ ] **Step 7: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 0 error / ✓ Compiled successfully。

---

### Task 3: 服务端胶水（getEmbeddingConfig / embedText / generateAndSaveEmbedding）

**Files:**
- Modify: `src/lib/ai/embedding-config.ts`（追加 `getEmbeddingConfig`）
- Modify: `src/lib/snippets/embedding.ts`（追加 `embedText` / `generateAndSaveEmbedding`）

**Interfaces:**
- Consumes: Task 1 的类型 + `parseEmbeddingConfig`；`decryptConfigValueForUse` from `@/lib/config-secrets`；`prisma` from `@/lib/db`；`moduleLogger` from `@/lib/logger`
- Produces:
  ```ts
  export async function getEmbeddingConfig(): Promise<EmbeddingConfig | null>;
  // embedding.ts
  export async function embedText(text: string, config: EmbeddingConfig): Promise<number[] | null>;
  export async function generateAndSaveEmbedding(snippetId: string): Promise<void>;
  ```

- [ ] **Step 1: `src/lib/ai/embedding-config.ts` 追加 `getEmbeddingConfig`**

顶部 import 追加（与既有 `parseJsonObjectOrArrayConfig` import 合并）：
```ts
import { decryptConfigValueForUse } from "@/lib/config-secrets";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("ai.embedding-config");
```
文件末尾追加：
```ts
/**
 * 读取 embedding 配置并解密 apiKey。不存在/解析失败 → null（不抛错，调用方据此跳过）。
 * 解密走 config-secrets 的 CONFIG_SECRET_FIELDS 注册（Task 2），保证存读一致。
 */
export async function getEmbeddingConfig(): Promise<EmbeddingConfig | null> {
  const item = await prisma.systemConfig.findUnique({
    where: { key: EMBEDDING_CONFIG_KEY },
  });
  if (!item) return null;
  try {
    const decrypted = decryptConfigValueForUse(EMBEDDING_CONFIG_KEY, item.value);
    return parseEmbeddingConfig(decrypted ?? "");
  } catch (e) {
    log.warn({ err: e }, "inkpress.embedding 解析失败（回落 null）");
    return null;
  }
}
```

- [ ] **Step 2: `src/lib/snippets/embedding.ts` 追加 `embedText` + `generateAndSaveEmbedding`**

顶部 import 追加：
```ts
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import { getEmbeddingConfig, type EmbeddingConfig } from "@/lib/ai/embedding-config";

const log = moduleLogger("snippets.embedding");

const EMBED_TIMEOUT_MS = 15000;
```
文件末尾追加：
```ts
/**
 * 原生 fetch `${baseUrl}/embeddings`（OpenAI 兼容）。超时 15s，吞错返 null。
 * 返回 data[0].embedding（number[]），维度由 config.dimensions 决定。
 */
export async function embedText(
  text: string,
  config: EmbeddingConfig
): Promise<number[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    const res = await fetch(`${config.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: [text],
        dimensions: config.dimensions,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = data.data?.[0]?.embedding;
    return Array.isArray(vec) ? vec : null;
  } catch (e) {
    log.warn({ err: e }, "embedText 失败");
    return null;
  }
}

/**
 * 加载 → composeEmbeddingInput → embedText → 写回 embedding。fire-and-forget 入口。
 * 全程吞错：任何异常只 warn，不影响已返回的 201/200。
 */
export async function generateAndSaveEmbedding(snippetId: string): Promise<void> {
  try {
    const config = await getEmbeddingConfig();
    if (!config) return;
    const s = await prisma.snippet.findUnique({ where: { id: snippetId } });
    if (!s) return;
    const input = composeEmbeddingInput(s);
    if (!input) return;
    const vec = await embedText(input, config);
    if (!vec) return;
    await prisma.snippet.update({
      where: { id: snippetId },
      data: { embedding: JSON.stringify(vec) },
    });
  } catch (e) {
    log.warn({ err: e, snippetId }, "generateAndSaveEmbedding 失败（不阻断）");
  }
}
```

- [ ] **Step 3: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 0 error / ✓ Compiled successfully。

---

### Task 4: 生成接线（POST/PATCH after）+ 客户端隔离（GET omit / types.ts 删字段）

**Files:**
- Modify: `src/app/api/snippets/route.ts`（POST after 加 embedding；GET findMany 加 omit）
- Modify: `src/app/api/snippets/[id]/route.ts`（PATCH after 加 embedding）
- Modify: `src/components/snippets/types.ts`（删 `embedding` 字段）

**Interfaces:**
- Consumes: `generateAndSaveEmbedding` from `@/lib/snippets/embedding`

- [ ] **Step 1: `src/app/api/snippets/route.ts` import**

顶部追加：
```ts
import { generateAndSaveEmbedding } from "@/lib/snippets/embedding";
```
（`generateAndSaveAiSummary` 已在 item19 引入，保持同一 import 区。）

- [ ] **Step 2: POST 的 `after()` 追加 embedding**

把 item19 的 `after(() => generateAndSaveAiSummary(snippet.id));` 改为并列两个：
```ts
  // 异步生成 aiSummary + embedding。fire-and-forget，各自吞错，互不阻断。
  after(() => {
    void generateAndSaveAiSummary(snippet.id);
    void generateAndSaveEmbedding(snippet.id);
  });
```

- [ ] **Step 3: GET 的 `findMany` 加 `omit`**

在 GET handler 的 `prisma.snippet.findMany({ where, orderBy, take, ... })` 调用里加 `omit`：
```ts
  const snippets = await prisma.snippet.findMany({
    where,
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: limit + 1,
    omit: { embedding: true }, // 不把 KB 级向量灌给前端
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
```

- [ ] **Step 4: `src/app/api/snippets/[id]/route.ts` — PATCH 的 `after()` 追加 embedding**

import 顶部加 `import { generateAndSaveEmbedding } from "@/lib/snippets/embedding";`
把 item19 的 `if (inputChanged) { after(() => generateAndSaveAiSummary(id)); }` 改为：
```ts
  if (inputChanged) {
    after(() => {
      void generateAndSaveAiSummary(id);
      void generateAndSaveEmbedding(id);
    });
  }
```

- [ ] **Step 5: `src/components/snippets/types.ts` 删 `embedding` 字段**

删除第 18 行 `embedding: string | null;`（连同其上注释行，若有的话）。

- [ ] **Step 6: typecheck + build + 回归**

Run: `pnpm typecheck && pnpm build && pnpm vitest run`
Expected: 0 error / ✓ Compiled / 全部测试 PASS（含 T1 新增）。

---

### Task 5: 语义检索（findSemanticSnippets）+ 路由集成（@面板 + 主搜索框）

**Files:**
- Modify: `src/lib/snippets/semantic-search.ts`（追加 `findSemanticSnippets`）
- Modify: `src/app/api/snippets/route.ts`（GET 合并）
- Modify: `src/app/api/snippets/search/route.ts`（GET 合并）

**Interfaces:**
- Consumes: `cosineSimilarity` from `"ai"`；`getEmbeddingConfig`；`embedText`；`mergeKeywordAndSemantic`；`prisma`

- [ ] **Step 1: `src/lib/snippets/semantic-search.ts` 追加 `findSemanticSnippets`**

顶部 import 追加：
```ts
import { cosineSimilarity } from "ai";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import { embedText } from "@/lib/snippets/embedding";
import { getEmbeddingConfig } from "@/lib/ai/embedding-config";

const log = moduleLogger("snippets.semantic-search");
```
> 路径明确：`embedText` 来自 `@/lib/snippets/embedding`（T3 定义），`getEmbeddingConfig` 来自 `@/lib/ai/embedding-config`（T3 定义）。不经中转 re-export。

文件末尾追加：
```ts
/**
 * 语义检索：embed q → 拉所有未删且 embedding 非空的素材 → cosineSimilarity → ≥threshold 取 topK。
 * 未配置 / embed 失败 / 维度不一致（跳过该条）→ 返 []，调用方回落子串。全量吞错。
 */
export async function findSemanticSnippets(
  q: string,
  opts?: { topK?: number; threshold?: number }
): Promise<SemanticHit[]> {
  const topK = opts?.topK ?? 20;
  const threshold = opts?.threshold ?? 0.3;
  try {
    const config = await getEmbeddingConfig();
    if (!config) return [];
    const qVec = await embedText(q, config);
    if (!qVec) return [];
    const rows = await prisma.snippet.findMany({
      where: { trashed: false, NOT: { embedding: null } },
      select: { id: true, embedding: true },
    });
    const scored: SemanticHit[] = [];
    for (const row of rows) {
      let vec: unknown;
      try {
        vec = JSON.parse(row.embedding);
      } catch {
        continue;
      }
      if (!Array.isArray(vec) || vec.length !== qVec.length) continue;
      const score = cosineSimilarity(qVec, vec as number[]);
      if (score >= threshold) scored.push({ id: row.id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  } catch (e) {
    log.warn({ err: e }, "findSemanticSnippets 失败（回落子串）");
    return [];
  }
}
```

> 若 `cosineSimilarity(qVec, vec)` 类型/签名不符（ai 包版本差异），typecheck 会报；按实际签名调整（如需 `number[]` 一致即可）。

- [ ] **Step 2: `src/app/api/snippets/route.ts` GET 合并 keyword + semantic**

import 顶部追加：
```ts
import { findSemanticSnippets, mergeKeywordAndSemantic } from "@/lib/snippets/semantic-search";
import { getEmbeddingConfig } from "@/lib/ai/embedding-config";
```

在 GET handler 内，`const snippets = await prisma.snippet.findMany(...)` **之后**、`const hasMore = ...` **之后**、`return NextResponse.json(...)` **之前**，插入合并（注意：合并基于已 pop 的 `snippets`，hasMore 仍按 keyword 计）：
```ts
  // 语义补充：q 非空 + 配了 embedding 时，用语义命中填补剩余 slot（keyword 优先）。
  const q = sp.get("q") || "";
  let merged = snippets;
  if (q) {
    const cfg = await getEmbeddingConfig();
    if (cfg) {
      const hits = await findSemanticSnippets(q, { topK: limit, threshold: 0.3 });
      if (hits.length) {
        const semSnippets = await prisma.snippet.findMany({
          where: { id: { in: hits.map((h) => h.id) }, trashed: false },
          omit: { embedding: true },
        });
        const scores: Record<string, number> = {};
        for (const h of hits) scores[h.id] = h.score;
        merged = mergeKeywordAndSemantic(snippets, semSnippets, scores, limit);
      }
    }
  }

  return NextResponse.json({ snippets: merged, nextCursor });
```
（删除原 `return NextResponse.json({ snippets, nextCursor });`）

- [ ] **Step 3: `src/app/api/snippets/search/route.ts` GET 合并**

import 顶部追加：
```ts
import { findSemanticSnippets, mergeKeywordAndSemantic } from "@/lib/snippets/semantic-search";
import { getEmbeddingConfig } from "@/lib/ai/embedding-config";
```

在该路由内，原 `const snippets = await prisma.snippet.findMany({ where, orderBy, take: limit, select: {...} });` 之后插入合并。注意该路由用 `select`（未含 embedding ✓），合并需对 select 后的形状操作；为拿到完整字段做语义补充，单独再 findMany 一次（select 同字段集）：
```ts
  // 语义补充（@面板）：q 非空 + 配了 embedding 时合并。
  let merged = snippets;
  if (q) {
    const cfg = await getEmbeddingConfig();
    if (cfg) {
      const hits = await findSemanticSnippets(q, { topK: limit, threshold: 0.3 });
      if (hits.length) {
        const semSnippets = await prisma.snippet.findMany({
          where: { id: { in: hits.map((h) => h.id) }, trashed: false },
          select: {
            id: true, title: true, aiSummary: true, content: true, kind: true,
            tagsJson: true, imageUrl: true, color: true, updatedAt: true,
          },
        });
        const scores: Record<string, number> = {};
        for (const h of hits) scores[h.id] = h.score;
        merged = mergeKeywordAndSemantic(snippets, semSnippets, scores, limit);
      }
    }
  }

  const items = merged.map((s) => ({
    id: s.id,
    title: s.title,
    summary: s.aiSummary || s.content.slice(0, 80),
    kind: s.kind,
    tags: JSON.parse(s.tagsJson) as string[],
    imageUrl: s.imageUrl,
    color: s.color,
    updatedAt: s.updatedAt,
  }));
```
（把原 `const items = snippets.map(...)` 改为基于 `merged`。）

- [ ] **Step 4: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 0 error / ✓ Compiled。

- [ ] **Step 5: 手测**（需先配 embedding，可用 T2 落地的 system-config 端点手动 PUT 一份 `inkpress.embedding`，或等 T7 表单）

1. 配置 embedding（智谱默认）。
2. backfill（T6）或新建几条素材等 after() 生成向量。
3. 主搜索框 / @面板输入一个**与素材正文无共同词但语义相关**的查询 → 命中相关素材。
4. 查询同时命中子串 + 语义 → 子串命中排前。

---

### Task 6: backfill 脚本

**Files:**
- Create: `scripts/backfill-embeddings.ts`

- [ ] **Step 1: 写脚本**

```ts
/**
 * 一次性回填既有素材的 embedding（手动跑，不入 entrypoint）：
 *   pnpm tsx scripts/backfill-embeddings.ts
 * 改过 dimensions 后需重跑（旧向量维度不一致会被检索跳过）。
 * 未配置 inkpress.embedding → 提示退出。
 */
import { prisma } from "@/lib/db";
import { generateAndSaveEmbedding } from "@/lib/snippets/embedding";
import { getEmbeddingConfig } from "@/lib/ai/embedding-config";

async function main() {
  const cfg = await getEmbeddingConfig();
  if (!cfg) {
    console.error("未配置 inkpress.embedding，先在设置页配置后重跑。");
    process.exit(1);
  }
  const targets = await prisma.snippet.findMany({
    where: { trashed: false, embedding: null },
    select: { id: true, title: true },
  });
  console.log(`待回填 ${targets.length} 条（dimensions=${cfg.dimensions}, model=${cfg.model}）`);
  let ok = 0;
  let fail = 0;
  let i = 0;
  for (const t of targets) {
    i++;
    process.stdout.write(`[${i}/${targets.length}] ${t.id} ${t.title.slice(0, 20)} ... `);
    const before = await prisma.snippet.findUnique({
      where: { id: t.id },
      select: { embedding: true },
    });
    await generateAndSaveEmbedding(t.id);
    const after = await prisma.snippet.findUnique({
      where: { id: t.id },
      select: { embedding: true },
    });
    if (after?.embedding && after.embedding !== before?.embedding) {
      ok++;
      console.log("✓");
    } else {
      fail++;
      console.log("✗（跳过/失败）");
    }
  }
  console.log(`\n完成：✓ ${ok}  ✗ ${fail}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 0 error（`scripts/**` 在 eslint ignore，但仍需 tsc 通过——确认 tsconfig 含 scripts，或脚本类型放宽）。

> 若 `scripts/**` 不在 tsconfig include，本步可能不覆盖脚本；改用 `pnpm exec tsc --noEmit scripts/backfill-embeddings.ts` 单独检查，或运行时由 tsx 报错暴露。

- [ ] **Step 3: 手测**（dry run）

Run: `pnpm tsx scripts/backfill-embeddings.ts`
Expected: 打印 `待回填 N 条` + 逐条 ✓/✗ + 完成汇总。未配置时打印错误退出。

---

### Task 7: 设置页 embedding 表单 + 测试端点

**Files:**
- Modify: `src/components/settings/SystemConfigManager.tsx`（仿 WebResearch：EmbeddingForm / parseEmbeddingValue / state / useEffect / saveEmbedding / `<EmbeddingEditor>`）
- Create: `src/app/api/ai/embeddings/test/route.ts`（POST：用已存配置打一次 sample embedding 验证连通）

**Interfaces:**
- Consumes: `EMBEDDING_CONFIG_KEY`, `DEFAULT_EMBEDDING_CONFIG`, `EmbeddingConfig` from `@/lib/ai/embedding-config`；`embedText`/`getEmbeddingConfig` from server；既有 `SystemConfig` 类型、`Input` 组件、`useTransition` 模式。

- [ ] **Step 1: 测试端点 `src/app/api/ai/embeddings/test/route.ts`**

```ts
import { NextResponse } from "next/server";
import { embedText } from "@/lib/snippets/embedding";
import { getEmbeddingConfig } from "@/lib/ai/embedding-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 用已存的 inkpress.embedding 配置打一次 sample embedding，验证连通 + 返回维度。 */
export async function POST() {
  const cfg = await getEmbeddingConfig();
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "未配置 embedding 供应商" }, { status: 400 });
  }
  const vec = await embedText("测试连通性", cfg);
  if (!vec) {
    return NextResponse.json({ ok: false, error: "调用失败，请检查 baseUrl/apiKey/model" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, dimensions: vec.length, model: cfg.model });
}
```

- [ ] **Step 2: SystemConfigManager — 类型 + 解析 + 默认**

在 `WEB_RESEARCH_CONFIG_KEY` 等常量旁加：
```ts
import {
  EMBEDDING_CONFIG_KEY,
  DEFAULT_EMBEDDING_CONFIG,
} from "@/lib/ai/embedding-config";
```
（顶部既有 `LLM_CONFIG_KEY` 等本地常量保留；`EMBEDDING_CONFIG_KEY` 直接从 lib import，与 `WEB_RESEARCH_CONFIG_KEY` 本地常量等价——为一致可也在本地 `export const EMBEDDING_CONFIG_KEY = "inkpress.embedding"`，二选一，避免重复。**推荐直接用 lib 导入的常量，删本地重复**。）

类型 + 解析（仿 WebResearch，放在 WebResearchForm/parseWebResearchValue 旁）：
```ts
type EmbeddingForm = {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
};

const DEFAULT_EMBEDDING_FORM: EmbeddingForm = {
  baseUrl: DEFAULT_EMBEDDING_CONFIG.baseUrl,
  apiKey: "",
  model: DEFAULT_EMBEDDING_CONFIG.model,
  dimensions: DEFAULT_EMBEDDING_CONFIG.dimensions,
};

function parseEmbeddingValue(value?: string): EmbeddingForm {
  if (!value) return { ...DEFAULT_EMBEDDING_FORM };
  try {
    const parsed = JSON.parse(value) as Partial<EmbeddingForm>;
    return {
      baseUrl:
        typeof parsed.baseUrl === "string" && parsed.baseUrl
          ? parsed.baseUrl
          : DEFAULT_EMBEDDING_CONFIG.baseUrl,
      apiKey:
        typeof parsed.apiKey === "string" && parsed.apiKey === "********"
          ? "" // 脱敏占位 → 空串，输入框显示 placeholder
          : parsed.apiKey ?? "",
      model:
        typeof parsed.model === "string" && parsed.model
          ? parsed.model
          : DEFAULT_EMBEDDING_CONFIG.model,
      dimensions:
        typeof parsed.dimensions === "number" ? parsed.dimensions : DEFAULT_EMBEDDING_CONFIG.dimensions,
    };
  } catch {
    return { ...DEFAULT_EMBEDDING_FORM };
  }
}
```

- [ ] **Step 3: SystemConfigManager — state + useEffect 回填 + value useMemo**

在组件内仿 webResearch 的三件套加：
```ts
const embeddingConfig = configsState.find((c) => c.key === EMBEDDING_CONFIG_KEY);
const [embeddingForm, setEmbeddingForm] = useState<EmbeddingForm>(() =>
  parseEmbeddingValue(embeddingConfig?.value)
);
useEffect(() => {
  setEmbeddingForm(parseEmbeddingValue(embeddingConfig?.value));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [configsState]);
const embeddingValue = useMemo(() => JSON.stringify(embeddingForm, null, 2), [embeddingForm]);
```

- [ ] **Step 4: SystemConfigManager — `saveEmbedding`**（仿 `saveWebResearch`）

```ts
async function saveEmbedding() {
  startTransition(async () => {
    setError("");
    try {
      const res = await fetch("/api/system-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: EMBEDDING_CONFIG_KEY, value: embeddingValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setConfigsState((prev) =>
        prev.some((c) => c.key === EMBEDDING_CONFIG_KEY)
          ? prev.map((c) => (c.key === EMBEDDING_CONFIG_KEY ? data.item : c))
          : [...prev, data.item]
      );
      setMessage("Embedding 配置已保存。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  });
}
```
（与既有 `saveWebResearch` 对照：message/error/setConfigsState 写法按当前文件实际为准。）

- [ ] **Step 5: SystemConfigManager — `<EmbeddingEditor>` 组件 + 渲染**

仿 `<WebResearchEditor>` 写一个 `<EmbeddingEditor>`（4 个 Input：baseUrl / apiKey(密码态，值为空时显示 placeholder「已保存（留空保留）」) / model / dimensions(select 或 number）；末尾「保存」+「测试连通」按钮）。测试按钮 fetch `POST /api/ai/embeddings/test`，内联反馈（沿用 `message`/`error`，无 toast lib）。

在 render 里 WebResearchEditor 同区（AI 相关配置 tab）渲染：
```tsx
<EmbeddingEditor
  value={embeddingForm}
  onChange={setEmbeddingForm}
  onSave={saveEmbedding}
  pending={pending}
/>
```
> 渲染位置：参照当前文件 `<WebResearchEditor>` 的渲染处（约 line 626），紧随其后。tab/分区归属与 WebResearch 一致（AI 配置区）。

- [ ] **Step 6: typecheck + build + lint**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: 0 error / ✓ Compiled / lint 0 errors（warnings = 基线）。

- [ ] **Step 7: 手测**

1. 设置页 AI 配置区出现 Embedding 表单（预填智谱默认）。
2. 填 apiKey → 保存 → 回显「********」。
3. 「测试连通」→ 成功显示维度（1024）/ 失败显示错误。
4. 改 dimensions → 保存 → 跑 backfill 重生成。

---

## Self-Review

**1. Spec 覆盖：**
- 配置 `inkpress.embedding`（4 字段 + 加密）→ T1 parseEmbeddingConfig + T2 注册 + T3 getEmbeddingConfig + T7 表单 ✓
- 生成（创建/编辑 after，复用 item19 触发字段）→ T3 generateAndSaveEmbedding + T4 POST/PATCH after ✓
- 检索（@面板 + 主框，共享，threshold 0.30/topK 20，cosineSimilarity）→ T5 ✓
- 合并（keyword 优先 → semantic-only score 降序 → 去重）→ T1 mergeKeywordAndSemantic ✓
- 客户端隔离（GET omit / search 已 clean / types.ts 删）→ T4 ✓
- backfill（手动 tsx）→ T6 ✓
- 设置表单 + 测试按钮 → T7 ✓

**2. Placeholder 扫描：** 无 TBD；关键字 verbatim（维度四档/默认 1024/threshold 0.30/topK 20/截断 1000/超时 15000/智谱默认 baseUrl+model）。T7 表单的「按当前文件实际为准」是镜像既有组件的合理指引（WebResearchEditor 是确切模板），非占位。

**3. 类型一致性：** `EmbeddingConfig` / `SnippetEmbeddingInput` / `SemanticHit` 在 T1 定义，T3/T5 复用。`mergeKeywordAndSemantic<T extends {id:string}>` 泛型在 T1 定义、T5 消费。`getEmbeddingConfig` 在 embedding-config.ts 定义；embedding.ts（T3）与 semantic-search.ts（T5）均直连 `@/lib/ai/embedding-config` import，不经 re-export。

**4. 加密一致性：** T2 同时注册写（maskConfigs/validateConfigValue/PUT 白名单/mergeMaskedSecrets）与读（config-secrets CONFIG_SECRET_FIELDS → decryptConfigValueForUse）→ T3 getEmbeddingConfig 解密路径正确。

**5. 客户端安全：** embedding-config/embedding/semantic-search 三文件均含 prisma/fetch，仅被 server route + 脚本 import；SystemConfigManager（client）只 import 常量 `EMBEDDING_CONFIG_KEY` + `DEFAULT_EMBEDDING_CONFIG`（纯值，无 prisma）——**确认 T7 Step 2 不 import 含 prisma 的符号**（只 import 常量）。

**6. ai 包 cosineSimilarity 签名风险：** T5 Step 1 已注「按实际签名调整」，typecheck 兜底。

## Execution Handoff

Plan 完成并落盘 `docs/superpowers/plans/2026-07-08-snippets-p3-ai-embedding.md`。

**执行方式（沿用本项目约定）：Inline（推荐）** —— 本 session 顺序跑 T1→T7，与「不自动 commit、收尾统一提交」兼容。Subagent-Driven 的 per-task commit 与 no-commit 约定冲突，不推荐。

**确认 Inline 开跑？** 我先建 `feat/snippets-p3-embedding` 子分支（从当前 `feat/snippets-p3-ai`），然后从 T1 动手。
