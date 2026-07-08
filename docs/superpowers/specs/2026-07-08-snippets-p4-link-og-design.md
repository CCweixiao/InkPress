# 素材块 P4-25（链接 OG 抓取）设计

> 日期：2026-07-08
> 分支：`feat/snippets-p4-link-og`（从 `feat/snippets-p3-embedding` 开 stacked 子分支）
> 范围：路线图 P4 的 **item 25**（链接素材自动抓取 OpenGraph）。

## 目标

link 素材设置 linkUrl 后，自动抓取 OpenGraph 元数据（linkTitle / linkDescription / linkImage）并填充字段，让 link 卡片自动变富（标题 + 摘要 + 预览图）。与 item 19 联动：OG 填 linkDescription 后，aiSummary 的 copy 策略零 AI 调用即可生成预览。

## 背景与现状

- `Snippet` 已有 `linkUrl` / `linkTitle` / `linkDescription` / `linkImage` 四字段（`prisma/schema.prisma:494-497`），**无 migration**。当前全部手动填、且基本没人填。
- **SSRF 守卫现成**：`src/lib/ai/safe-web.ts` 的 `assertSafePublicUrl`（DNS 解析 + 私网/环回/链路本地/保留地址拦截 + 协议/认证限制），返回校验后的 URL 字符串。
- **重定向安全 fetch 现成**：`src/lib/ai/tools/web-research.ts` 的 `fetchWithSafeRedirects` + `fetchWebPage`（timeout 15s 默认、size 控制、`fetchImpl` 注入便于单测）——OG 抓取镜像这套模式。
- **`jsdom@^29` 已装**，可解析 HTML 抽 `<meta og:*>` + `<title>` 兜底，无需新依赖。无既有 OG 解析代码（greenfield）。
- **SnippetCard 当前 link 渲染**（`SnippetCard.tsx:154-164`）：仅 `linkTitle || linkUrl` + linkUrl，**未渲染 linkDescription / linkImage** → OG 无可见价值，必须升级卡片。
- **item 19 联动**：`decideStrategy` 对 link 有 linkDescription 走 `"copy"`（aiSummary = linkDescription，零 AI）。OG 填 linkDescription 后触发此路径。
- **item 20**：embedding 的 `composeEmbeddingInput` 对 link 已含 `linkTitle` + `linkDescription`，OG 填充后向量质量也提升。

## 关键设计决策（已与用户确认）

1. **时机**：**异步 `after()`**（POST/PATCH 立即返回，OG 后台写回），与 aiSummary/embedding 一致。
2. **卡片渲染升级 + 手动重新抓取按钮**：均纳入本轮（否则 OG 无可见价值/不可控）。
3. **图片**：存**远程 og:image URL**（`linkImage`），不下载到 asset。

## 数据模型

无变更。复用既有 `linkUrl` / `linkTitle` / `linkDescription` / `linkImage`（均 `String?`）。

## 架构

```
POST/PATCH（kind=link + linkUrl）
  └─ after(async () => {
        await generateAndSaveOg(id, {force});  // 1) link 先抓 OG → 填 linkDescription
        void generateAndSaveAiSummary(id);      // 2) copy 策略可命中（零 AI）
        void generateAndSaveEmbedding(id);      // 3) 向量含 OG 文本
     })

手动「重新抓取」按钮 → POST /api/snippets/[id]/refetch-og
  └─ await generateAndSaveOg(id, {force:true}) → 同步返回更新后 snippet
```

### 模块布局

| 文件 | 职责 | 类别 |
|---|---|---|
| `src/lib/snippets/link-og.ts`（新） | `parseOgHtml(html)`（纯）/ `fetchOgMetadata(url)`（SSRF+fetch+jsdom）/ `generateAndSaveOg(id, opts)` | 服务端（含纯函数） |
| `src/app/api/snippets/route.ts`（改） | POST `after()` 加 OG（force） | 路由 |
| `src/app/api/snippets/[id]/route.ts`（改） | PATCH 触发字段加 `linkUrl`；`after()` 加 OG（linkUrl 变化→force） | 路由 |
| `src/app/api/snippets/[id]/refetch-og/route.ts`（新） | POST：`await generateAndSaveOg(id,{force:true})` 同步返回 | 路由 |
| `src/components/snippets/SnippetCard.tsx`（改） | link 卡片渲染 linkTitle + linkDescription + linkImage + 重新抓取按钮 | 前端 |
| `tests/unit/snippet-link-og.test.ts`（新） | `parseOgHtml` 纯函数测试 | 测试 |

**客户端 bundle 安全**：`link-og.ts` 仅服务端 import（`safe-web` + `jsdom` + prisma）；SnippetCard 只通过 fetch 调端点，不 import 该模块。

## 行为规约

### `parseOgHtml(html)`（纯函数）

输入 HTML 字符串，返回 `{ title?: string; description?: string; image?: string }`：
- 用 `jsdom` `new JSDOM(html)` 解析，取 `document`。
- title：`<meta property="og:title">` content → 兜底 `<meta name="twitter:title">` → 兜底 `<title>`。
- description：`og:description` → `twitter:description` → `<meta name="description">`。
- image：`og:image` → `twitter:image`（解析为绝对 URL：相对路径用页面 base url 拼接，但 parseOgHtml 不知 base → 仅取 content 原值；`fetchOgMetadata` 在外层用最终 fetch URL 补全相对路径）。
- 各字段 trim；空 → 不含该键。
- 非 html / 空 / jsdom 抛错 → 返 `{}`。

> 相对路径补全：`fetchOgMetadata` 持有 finalUrl（重定向后），对 image 做 `new URL(imageAttr, finalUrl).toString()` 补全。parseOgHtml 只抽原始 content。

### `fetchOgMetadata(url)`

- `assertSafePublicUrl(url)` → SSRF 守卫，失败抛错（被外层吞）。
- `fetch(safeUrl, { headers: { "User-Agent": "InkPress/1.0 LinkPreview", Accept: "text/html" }, redirect: "manual" })` + 重定向安全跟随（复用/镜像 `fetchWithSafeRedirects`，每跳重新 `assertSafePublicUrl`，最多 5 跳）。
- timeout **10s**（AbortController）。
- 响应 size 控制：读 `text()` 后截断到 **1MB**（防巨型 HTML）。
- `content-type` 非 html（如 image/pdf/json）→ 返 null。
- `parseOgHtml(html)` → 补全 image 相对路径（用 finalUrl）→ 返回 `{title, description, image} | null`。
- 全程 try/catch → 返 null。

### `generateAndSaveOg(snippetId, opts?: { force?: boolean })`

- load snippet；`kind !== "link" || !linkUrl` → 直接返回。
- `fetchOgMetadata(linkUrl)` → null → 返回（吞错，留空字段）。
- 应用字段：
  - `force`：三个字段都写 OG 值（空 OG 值不清空已有）。
  - 非 force：仅写**当前为空**的字段（保留用户手填）。
- 实际上 OG 值为 undefined 的字段始终跳过（不写空）。force 与否只在「字段已有值时是否覆盖」。
- `prisma.snippet.update`（仅在有变化时）。全量 try/catch + warn。

### 触发与 force 策略

| 场景 | force | 说明 |
|---|---|---|
| POST 创建（kind=link + linkUrl） | `true` | 新建，字段空 |
| PATCH linkUrl 变化 | `true` | 新链接，覆盖旧 OG |
| PATCH 仅改其他字段 | 不触发 OG | linkUrl 没变，旧 OG 仍有效 |
| 手动「重新抓取」 | `true` | 显式覆盖 |

### after() 顺序（关键：OG 先于 aiSummary）

```ts
after(async () => {
  await generateAndSaveOg(snippet.id, { force });   // link 先填 linkDescription
  void generateAndSaveAiSummary(snippet.id);         // copy 策略命中 → 零 AI
  void generateAndSaveEmbedding(snippet.id);         // 向量含 OG 文本
});
```
- 非 link：`generateAndSaveOg` 自守卫秒返，aiSummary/embedding 不受影响。
- PATCH 触发字段集（`inputChanged`）新增 `linkUrl`。

### 卡片渲染升级（`SnippetCard.tsx` link 分支）

- 标题：`linkTitle || linkUrl`（不变）。
- 摘要：`linkDescription`（存在时显示，line-clamp 2 行）。
- 预览图：`linkImage` 存在时显 `<img>`（**原生 `<img>`**，`referrerPolicy="no-referrer"`、`loading="lazy"`、固定高度 `object-cover`；失败 `onError` 隐藏）。
- hover 出「重新抓取」按钮（Pencil 旁）→ `POST /api/snippets/[id]/refetch-og` → 用返回的 snippet 更新本地状态（内联反馈「✓ 已更新」/「抓取失败」2s，无 toast lib）。

### refetch-og 端点

`POST /api/snippets/[id]/refetch-og`：
- load；不存在 → 404。
- `await generateAndSaveOg(id, { force: true })`（同步，手动动作要即时反馈）。
- 重新 load 返回更新后的 snippet（`omit:{embedding:true}`）。
- 整体 try/catch：失败 → 500 `{error}`。

## 错误处理（铁律）

- **OG 失败永不阻断创建/编辑**：`fetchOgMetadata` / `generateAndSaveOg` 双层吞错，字段留空，卡片回落 linkUrl。
- **SSRF 拒绝**：`assertSafePublicUrl` 抛错被吞，留空。
- `after()` 异常不影响已返回的 201/200。
- refetch 端点失败 → 500 + 内联提示（手动动作允许报错反馈）。

## 测试边界（TDD = 纯逻辑）

vitest 覆盖 `parseOgHtml(html)`：
- og 三件套齐全 → 全返。
- 仅 og:title / 仅 og:description / 仅 og:image。
- og 缺失 → 回落 `<title>` + `<meta name="description">`。
- twitter:* 兜底。
- 空 html / 非 html / 纯文本 → `{}`。
- 多余空白 trim。

**不**进 vitest：`fetchOgMetadata` 实调、`generateAndSaveOg`、路由、卡片渲染。走 typecheck + build + 手测。

## 验收（手测）

1. 创建 link 素材（linkUrl 指向一个有 OG 的页面，如 GitHub 仓库）→ 刷新 → 卡片显 title + description + 预览图。
2. 无 OG 的页面 → 卡片回落 `<title>` + linkUrl，不报错。
3. 私网/本机 URL（如 `http://127.0.0.1`）→ SSRF 拒绝，字段空，不报错。
4. 改 linkUrl → OG 覆盖更新。
5. 手填 linkTitle 后改其他字段 → linkTitle 不被覆盖（非 force）。
6. 「重新抓取」按钮 → 强制刷新 OG，内联反馈。
7. 非 link 素材 → 不触发 OG，aiSummary/embedding 正常。

## 范围外（本轮不做）

- og:image 下载到 asset（隐私/防盗链/永久化）。
- favicon 抓取。
- 全文抓取 / 正文提取（已有 `fetchWebPage`，不在本范围）。
- OG 缓存 / TTL。
- 多语言标题偏好。
- link 创建专用入口（粘贴 URL 自动识别 kind=link）——沿用现有 POST/PATCH 设 linkUrl。
