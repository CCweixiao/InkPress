# 素材块 P3-AI（item 20：embedding 语义检索）设计

> 日期：2026-07-08
> 分支：`feat/snippets-p3-embedding`（从 `feat/snippets-p3-ai` 开 stacked 子分支）
> 范围：路线图 P3-AI 的 **item 20**（embedding 语义检索），收完 P3-AI 弧线。承接 item 19（AI 摘要，已落地）。

## 目标

为素材块生成语义向量，让 @面板与 /snippets 主搜索框支持「词不同但语义相关」的召回，补齐 P3-AI 的语义检索闭环。未配置 embedding 或素材无向量时，一律回落到现有子串检索，零回归。

## 背景与现状

- `Snippet.embedding` 字段已存在（`prisma/schema.prisma:508`，`String?`，存 JSON `float[]`），**始终 null，从未被消费**。无 migration。
- 全仓库零 cosine/similarity/vector 代码（greenfield）。
- AI infra：`@ai-sdk/anthropic` 不提供 embeddings（Anthropic 无此 API）；`@ai-sdk/openai` 未安装。`ai@^6` 包**内置 `cosineSimilarity` / `embed` / `embedMany`**，数学工具现成。
- 默认聊天 provider 是智谱 GLM（`open.bigmodel.cn/api/anthropic`）。智谱的 embedding 走 **OpenAI 兼容端点** `/api/paas/v4/embeddings`（model `embedding-3`，支持 256/512/1024/2048 维），与聊天端点不同源、不可推导 → 需独立配置。
- 设置架构：`SystemConfigManager.tsx` 为每个 `inkpress.*` key 渲染**专用表单**，PUT `{key,value}` 到 `/api/system-config`。`inkpress.llm` 走加密信封（`secret-store` + `config-secrets`）。
- ⚠️ `src/components/snippets/types.ts:18` 把 `embedding` 泄漏到客户端 `SnippetItem`；`/api/snippets` GET 的 `findMany` 无 select → 一旦填充 embedding，会把 KB 级 float[] 灌给前端。**必须隔离**。
- `/api/snippets/search`（@面板）已用 `select` 且未含 embedding ✓。

## 关键设计决策（已与用户确认）

1. **范围**：item 20 全量（配置 + 生成 + 检索 + backfill + 设置表单），方案 A。
2. **Provider**：**独立 `inkpress.embedding` 配置 + 原生 fetch**。新增 SystemConfig key（单 provider，4 字段），不引入 `@ai-sdk/openai` 依赖，不厂商推导。cosine 用 `ai` 包内置。
3. **搜索入口**：**@面板 + /snippets 主搜索框**双入口（共享逻辑），GlobalSearch 保持子串。

## 数据模型

无变更。复用既有 `embedding String?`（JSON `float[]`）。维度由配置决定（默认 1024）。改维度需 backfill 重新生成全部向量（维度不一致无法比对）。

## 架构

```
配置：inkpress.embedding（SystemConfig，加密 apiKey）
  │
  ├─ 创建/编辑（after，复用 item19 触发字段）
  │    └─ generateAndSaveEmbedding(id): load → composeEmbeddingInput → embedText → update
  │
  ├─ 搜索（q 非空 + 配了 embedding）
  │    └─ findSemanticSnippets(q): embed q → load all embeddings → cosineSimilarity → ≥0.30 top20
  │         └─ mergeKeywordAndSemantic(子串命中, 语义命中): keyword 优先 → semantic-only(score desc) → 去重
  │
  └─ Backfill：scripts/backfill-embeddings.ts（手动 tsx，遍历 embedding IS NULL）
```

### 模块布局

| 文件 | 职责 | 类别 |
|---|---|---|
| `src/lib/ai/embedding-config.ts`（新） | `getEmbeddingConfig()` / `parseEmbeddingConfig()`，加密 apiKey（复用 `secret-store`+`config-secrets`） | 服务端 |
| `src/lib/snippets/embedding.ts`（新） | `composeEmbeddingInput` / `embedText` / `generateAndSaveEmbedding` | 服务端（含纯函数） |
| `src/lib/snippets/semantic-search.ts`（新） | `findSemanticSnippets` / `mergeKeywordAndSemantic`（纯函数） | 服务端（含纯函数） |
| `src/app/api/snippets/route.ts`（改） | GET：q 非空 + 配置就绪 → 合并语义；`findMany` 加 `omit:{embedding:true}` | 路由 |
| `src/app/api/snippets/search/route.ts`（改） | GET：同上合并语义（select 已不含 embedding） | 路由 |
| `src/app/api/snippets/route.ts` + `[id]/route.ts`（改） | POST/PATCH 的 `after()` 追加 `generateAndSaveEmbedding`（与 aiSummary 并列） | 路由 |
| `src/components/settings/SystemConfigManager.tsx`（改） | 新增 embedding 表单区（4 字段 + 测试按钮） | 前端 |
| `src/components/snippets/types.ts`（改） | 删 `embedding` 字段 | 前端类型 |
| `scripts/backfill-embeddings.ts`（新） | 手动回填脚本 | 运维 |

**客户端 bundle 安全**：`embedding-config.ts` / `embedding.ts` / `semantic-search.ts` 仅服务端 import（prisma + fetch + provider），不进 `"use client"` 链路。纯函数 `mergeKeywordAndSemantic` / `composeEmbeddingInput` 可被服务端路由直接 import；不拆 meta/finalize（无客户端消费者）。

## 行为规约

### 配置（`inkpress.embedding`）

```jsonc
{
  "baseUrl": "https://open.bigmodel.cn/api/paas/v4",  // 去尾斜杠
  "apiKey": "<encrypted>",                              // 存储加密，读出解密
  "model": "embedding-3",
  "dimensions": 1024                                    // 256|512|1024|2048
}
```

- `parseEmbeddingConfig(value)`：必填 baseUrl + apiKey + model；dimensions 缺省 1024，非法值（非上述四档）回落 1024。
- `getEmbeddingConfig()`：读 SystemConfig，解密 apiKey；不存在/解析失败 → 返 `null`（不抛错）。
- 未配置时，生成与检索都静默跳过（生成返 null、检索返 `[]`），不报错、不阻断。

### Embedding 生成

- `composeEmbeddingInput(s)`：
  - text：`content`
  - quote：`${content}\n—— ${quoteSource}`（出处空则不追加）
  - link：`${content}\n${linkTitle ?? ""}\n${linkDescription ?? ""}`（空段不追加）
  - image：`content`（caption）
  - 截断 ≤ 1000 字；`trim().length < 3` → 返空串（跳过 embed）。
- `embedText(text)`：原生 `fetch` `${baseUrl}/embeddings`，body `{ model, input:[text], dimensions }`，Authorization `Bearer ${apiKey}`，取 `data[0].embedding`（`number[]`）。超时 15s，吞错返 `null`。
- `generateAndSaveEmbedding(snippetId)`：load → compose → 空串跳过 → embedText → null 跳过 → update DB。全量 try/catch + warn，不阻断。
- 触发：复用 item 19 的 `after()` + 字段变化检测（content/kind/quoteSource/linkTitle/linkDescription）。**与 aiSummary 共用一次 `after()` 调用**（各自独立 try/catch，互不影响）。

### 语义检索

- `findSemanticSnippets(q, topK=20, threshold=0.30)`：
  1. `embedText(q)` → query 向量；null → 返 `[]`。
  2. `prisma.snippet.findMany({ where:{ trashed:false, NOT:{ embedding:null } }, select:{ id:true, embedding:true } })`。
  3. 逐条 `JSON.parse(embedding)` → `number[]`；长度 ≠ query 长度（维度不一致，如改过配置）→ 跳过该条。
  4. `cosineSimilarity(query, vec)`（`ai` 包内置）≥ threshold → 入选。
  5. 按 score 降序取 topK → 返 `{ id, score }[]`。吞错返 `[]`。
- `mergeKeywordAndSemantic(keywordSnippets, semanticHits, limit)`（纯函数）：
  - keyword 命中（现有子串逻辑，已是 `Snippet[]`）保留原序，标 `source:"keyword"`。
  - semantic 命中中**不在 keyword 集合**的，按 score 降序追加，标 `source:"semantic"`。
  - 合并后截断 `limit`。
  - 结果：精确匹配永远在前，语义补充相关项。

### 路由集成

两个 GET 路由共用同一合并 helper：
1. 按现有逻辑算 keyword 命中（`Snippet[]`，含分页/cursor/limit）。
2. 若 `q` 非空且 `getEmbeddingConfig()` 非空：`findSemanticSnippets(q)` → 取 semantic-only 的 id 集 → `findMany({ where:{ id:{ in }, trashed:false }, ... })` 补成 `Snippet[]`（`omit:{embedding:true}`）。
3. `mergeKeywordAndSemantic(keyword, semanticSnippets, limit)` 合并返回。
- 主搜索框（`/api/snippets` GET）：limit 取 `min(limit, 100)`；语义补充不超过 limit。
- @面板（`/api/snippets/search` GET）：limit 取 `min(limit, 20)`；items 映射不变。

### 客户端隔离

- `/api/snippets` GET：`findMany` 加 `omit: { embedding: true }`（Prisma 7 原生支持）。
- `/api/snippets/search` GET：select 已不含 embedding ✓（不动）。
- `src/components/snippets/types.ts`：删第 18 行 `embedding: string | null`。

### Backfill

`scripts/backfill-embeddings.ts`（tsx，手动 `pnpm tsx scripts/backfill-embeddings.ts`，不入 entrypoint）：
- `getEmbeddingConfig()` 为 null → 提示退出。
- 遍历 `where:{ trashed:false, embedding:null }`，逐条 `generateAndSaveEmbedding(id)`，每条打印 `[i/N] id ✓/✗`。
- 改过 dimensions 后重跑（先把目标 embedding 置 null 或加 `--force`）。

## 错误处理（铁律）

- **生成失败 / 未配置 → 永不阻断创建/编辑**：`embedText`/`generateAndSaveEmbedding` 双层吞错，留 null，warn 日志。
- **检索失败 / 未配置 → 回落子串**：`findSemanticSnippets` 返 `[]`，合并后等价于纯子串结果。
- **维度不一致**（改配置后旧向量）：比对时跳过该条（长度校验），不抛错；backfill 重生成。
- `after()` 异常不影响已返回的 201/200。

## 并发与陈旧

- 编辑触发的重 embed 与在途旧 embed 竞争：last writer wins（embedding 是派生缓存）。
- 检索时 embedding 可能正在被并发更新：读到旧向量也能算分（近似可接受）。

## 测试边界（TDD = 纯逻辑）

vitest 覆盖：
- `composeEmbeddingInput`：text/quote(带/不带 source)/link(带/不带 title&desc)/image/<3 字跳过/截断。
- `mergeKeywordAndSemantic`：纯 keyword / 纯 semantic / 混合去重 / keyword 优先 / score 降序 / limit 截断。
- `parseEmbeddingConfig`：完整 / 缺 dimensions 回落 / 非法 dimensions 回落 / 缺必填抛错。

**不**进 vitest：`embedText` 实调 fetch、`cosineSimilarity`（信任 ai 包）、路由接线、设置表单、backfill 脚本。走 typecheck + build + 手测。

## 验收（手测）

1. **未配 embedding**：创建/搜索一切如常，回落子串，无报错。
2. **配置 embedding（智谱默认）**：设置页填 baseUrl/apiKey/model=embedding-3/dimensions=1024，「测试」连通。
3. **backfill**：`pnpm tsx scripts/backfill-embeddings.ts` 回填既有素材，打印进度。
4. **生成**：创建 text 素材 → DB `embedding` 字段非空（JSON float[1024]）。
5. **@面板语义**：输入一个**与素材正文无共同词但语义相关**的查询 → 命中相关素材（标 semantic）。
6. **主搜索框语义**：同上。
7. **keyword 优先**：查询同时命中子串 + 语义 → 子串命中排前。
8. **客户端隔离**：`/api/snippets` 响应体无 `embedding` 字段。
9. **改 dimensions**：旧向量比对跳过（不报错），backfill 后恢复。

## 范围外（本轮不做）

- GlobalSearch 语义化（保持子串，范围独立）。
- ANN / 向量索引 / embedding 缓存（万级库才需要）。
- 设置页「重新生成全部向量」按钮（走 backfill 脚本即可）。
- 多 embedding provider（单 provider 足够）。
- AI 改写 title（item 19 已确认维持首行抽取）。
