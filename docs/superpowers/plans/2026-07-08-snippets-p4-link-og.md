# 素材块 P4-25（链接 OG 抓取）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans（inline）按 task 执行。步骤用 `- [ ]` 复选框跟踪。**本项目约束：不自动 commit，全部任务完成、用户发话后一次性统一提交**——各 task 不含 commit 步骤，仅以 typecheck / 测试 / build / lint 作为完成 gate。

**Goal:** link 素材设 linkUrl 后异步抓取 OpenGraph（linkTitle/Description/Image）填充字段；升级卡片渲染 OG 三件套；提供手动「重新抓取」按钮。

**Architecture:** 纯逻辑 `parseOgHtml`（jsdom 抽 og:*→twitter:*→`<title>` 兜底，vitest）+ 服务端 `fetchOgMetadata`（`assertSafePublicUrl` SSRF 守卫 + 手动重定向 + size/timeout cap）+ `generateAndSaveOg`（force/填空策略，吞错）。POST/PATCH 的 `after()` 把 OG 跑在 aiSummary 前（copy 策略联动）。新增 refetch-og 端点 + SnippetCard 渲染升级。

**Tech Stack:** Next 16.2.9 · `jsdom@^29`（已装，OG 解析）· `assertSafePublicUrl`（`@/lib/ai/safe-web`）· vitest。

**Spec:** `docs/superpowers/specs/2026-07-08-snippets-p4-link-og-design.md`

## Global Constraints

- **不自动 commit**：全部完成后由用户统一发话再提交。
- **OG 失败永不阻断创建/编辑**：`fetchOgMetadata` / `generateAndSaveOg` 双层吞错，字段留空，卡片回落 linkUrl。
- **SSRF 守卫**：每跳（含重定向）都过 `assertSafePublicUrl`；私网/环回/保留地址在 fetch 前拒绝。
- **TDD 边界 = 纯逻辑**：仅 `parseOgHtml` 进 vitest；fetch / generateAndSaveOg / 路由 / 卡片走 typecheck + build + 手测。
- **客户端 bundle 安全**：`link-og.ts` 仅服务端 import（jsdom + safe-web + prisma）；SnippetCard 只经 fetch 调端点。
- **after() 顺序（verbatim）**：`await generateAndSaveOg(id,{force})` → `void generateAndSaveAiSummary(id)` → `void generateAndSaveEmbedding(id)`。OG 先于 aiSummary，保 copy 策略联动。
- **fetch 参数（verbatim）**：timeout `10000ms`、HTML cap `1MB`、最多 `5` 跳、User-Agent `InkPress/1.0 LinkPreview`、Accept `text/html,application/xhtml+xml,*/*;q=0.8`、`redirect:"manual"`。
- **force 策略**：POST 创建 / PATCH linkUrl 变化 / 手动 refetch → `force:true`（覆盖）；其余 PATCH → 填空（保留手填）。OG 值为 undefined 的字段始终不写。

## Pre-flight

- 分支：从当前 `feat/snippets-p3-embedding` 开 stacked 子分支 `feat/snippets-p4-link-og`。

---

### Task 1: 纯逻辑 `parseOgHtml` + vitest

**Files:**
- Create: `src/lib/snippets/link-og.ts`（仅 `OgMeta` 类型 + `parseOgHtml`，含 jsdom import）
- Test: `tests/unit/snippet-link-og.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OgMeta = { title?: string; description?: string; image?: string };
  export function parseOgHtml(html: string): OgMeta;
  ```

- [ ] **Step 1: 写失败测试** `tests/unit/snippet-link-og.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { parseOgHtml } from "@/lib/snippets/link-og";

describe("parseOgHtml", () => {
  it("og 三件套齐全", () => {
    const html = `<html><head>
      <meta property="og:title" content="标题">
      <meta property="og:description" content="摘要">
      <meta property="og:image" content="https://x.com/a.png">
    </head><body></body></html>`;
    expect(parseOgHtml(html)).toEqual({
      title: "标题",
      description: "摘要",
      image: "https://x.com/a.png",
    });
  });
  it("仅 og:title", () => {
    const html = `<meta property="og:title" content="只有标题">`;
    expect(parseOgHtml(html)).toEqual({ title: "只有标题" });
  });
  it("og 缺失回落 <title> + <meta description>", () => {
    const html = `<html><head><title>页面标题</title>
      <meta name="description" content="页面摘要"></head><body></body></html>`;
    expect(parseOgHtml(html)).toEqual({ title: "页面标题", description: "页面摘要" });
  });
  it("twitter:* 兜底", () => {
    const html = `<meta name="twitter:title" content="TW 标题">
      <meta name="twitter:image" content="https://x.com/tw.png">`;
    expect(parseOgHtml(html)).toEqual({
      title: "TW 标题",
      image: "https://x.com/tw.png",
    });
  });
  it("空 html 返 {}", () => {
    expect(parseOgHtml("")).toEqual({});
  });
  it("纯文本（非 html）返 {}", () => {
    expect(parseOgHtml("hello world 不是 html")).toEqual({});
  });
  it("content 前后空白被 trim", () => {
    const html = `<meta property="og:title" content="  带空白  ">`;
    expect(parseOgHtml(html)).toEqual({ title: "带空白" });
  });
  it("image 保留原始 content（相对路径不补全）", () => {
    const html = `<meta property="og:image" content="/static/img/a.png">`;
    expect(parseOgHtml(html)).toEqual({ image: "/static/img/a.png" });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm vitest run tests/unit/snippet-link-og.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/snippets/link-og.ts`**（仅以下内容）

```ts
import { JSDOM } from "jsdom";

export type OgMeta = { title?: string; description?: string; image?: string };

/** 按 selectors 顺序读第一个非空 meta content。 */
function readMeta(doc: Document, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const content = el?.getAttribute("content");
    if (content && content.trim()) return content.trim();
  }
  return undefined;
}

/**
 * 纯函数：从 HTML 抽 OG 元数据。
 * 优先级：og:* → twitter:* → <title>/<meta name="description"> 兜底。
 * image 返回原始 content（相对路径由 fetchOgMetadata 用 finalUrl 补全）。
 * 空/非 html/jsdom 抛错 → 返 {}。
 */
export function parseOgHtml(html: string): OgMeta {
  if (!html || !html.trim()) return {};
  let doc: Document;
  try {
    doc = new JSDOM(html, { url: "about:blank" }).window.document;
  } catch {
    return {};
  }
  const ogTitle = readMeta(doc, [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
  ]);
  const title =
    ogTitle ??
    doc.querySelector("title")?.textContent?.trim() ||
    undefined;
  const description = readMeta(doc, [
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    'meta[name="description"]',
  ]);
  const image = readMeta(doc, [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
  ]);
  const out: OgMeta = {};
  if (title) out.title = title;
  if (description) out.description = description;
  if (image) out.image = image;
  return out;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm vitest run tests/unit/snippet-link-og.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: 0 error。

---

### Task 2: 服务端胶水（fetchOgMetadata / generateAndSaveOg）+ POST/PATCH 接线

**Files:**
- Modify: `src/lib/snippets/link-og.ts`（追加 fetchOgMetadata / fetchHtmlSafe / generateAndSaveOg）
- Modify: `src/app/api/snippets/route.ts`（POST after 加 OG force:true）
- Modify: `src/app/api/snippets/[id]/route.ts`（PATCH：inputChanged 加 linkUrl；after 加 OG，force=linkUrlChanged）

**Interfaces:**
- Consumes: `assertSafePublicUrl` from `@/lib/ai/safe-web`；`prisma` / `moduleLogger`；Task 1 的 `parseOgHtml` / `OgMeta`
- Produces:
  ```ts
  export async function fetchOgMetadata(url: string): Promise<OgMeta | null>;
  export async function generateAndSaveOg(snippetId: string, opts?: { force?: boolean }): Promise<void>;
  ```

- [ ] **Step 1: `src/lib/snippets/link-og.ts` 顶部追加 import + 常量**

在既有 `import { JSDOM } from "jsdom";` 之后追加：
```ts
import { assertSafePublicUrl } from "@/lib/ai/safe-web";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("snippets.link-og");

const OG_TIMEOUT_MS = 10000;
const OG_MAX_HTML = 1024 * 1024; // 1MB
const OG_MAX_REDIRECTS = 5;
```

- [ ] **Step 2: 追加 `fetchHtmlSafe` + `fetchOgMetadata`**

在 `parseOgHtml` 之后追加：
```ts
/**
 * SSRF-safe HTML 抓取：assertSafePublicUrl 每跳重校验 + 手动重定向 + timeout + size cap。
 * 返回 { html, finalUrl } 或 null（非 html / 不 ok / 重定向过多 / 超时）。
 * assertSafePublicUrl 抛错向上传播（由 fetchOgMetadata 吞）。
 */
async function fetchHtmlSafe(
  startUrl: string
): Promise<{ html: string; finalUrl: string } | null> {
  let url = await assertSafePublicUrl(startUrl);
  for (let i = 0; i < OG_MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OG_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": "InkPress/1.0 LinkPreview",
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        },
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      url = await assertSafePublicUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(ct)) return null;
    const html = (await res.text()).slice(0, OG_MAX_HTML);
    return { html, finalUrl: url };
  }
  return null;
}

/** 抓取并解析 OG 元数据。相对 image 用 finalUrl 补全为绝对 URL。全量吞错返 null。 */
export async function fetchOgMetadata(url: string): Promise<OgMeta | null> {
  try {
    const fetched = await fetchHtmlSafe(url);
    if (!fetched) return null;
    const meta = parseOgHtml(fetched.html);
    if (meta.image) {
      try {
        meta.image = new URL(meta.image, fetched.finalUrl).toString();
      } catch {
        /* 补全失败保留原值 */
      }
    }
    return meta;
  } catch (e) {
    log.warn({ err: e, url }, "fetchOgMetadata 失败");
    return null;
  }
}

/**
 * 加载 → fetchOgMetadata → 按 force 策略写回 linkTitle/Description/Image。
 * 非 link 或无 linkUrl → 直接返回。全量吞错，不阻断创建/编辑。
 */
export async function generateAndSaveOg(
  snippetId: string,
  opts?: { force?: boolean }
): Promise<void> {
  try {
    const s = await prisma.snippet.findUnique({ where: { id: snippetId } });
    if (!s || s.kind !== "link" || !s.linkUrl) return;
    const meta = await fetchOgMetadata(s.linkUrl);
    if (!meta) return;
    const force = opts?.force === true;
    const data: {
      linkTitle?: string;
      linkDescription?: string;
      linkImage?: string;
    } = {};
    if (meta.title && (force || !s.linkTitle)) data.linkTitle = meta.title;
    if (meta.description && (force || !s.linkDescription))
      data.linkDescription = meta.description;
    if (meta.image && (force || !s.linkImage)) data.linkImage = meta.image;
    if (Object.keys(data).length === 0) return;
    await prisma.snippet.update({ where: { id: snippetId }, data });
  } catch (e) {
    log.warn({ err: e, snippetId }, "generateAndSaveOg 失败（不阻断）");
  }
}
```

- [ ] **Step 3: POST 路由 `after()` 加 OG**（`src/app/api/snippets/route.ts`）

import 顶部加：
```ts
import { generateAndSaveOg } from "@/lib/snippets/link-og";
```
把 item20 的 POST `after()` 改为 OG 先行：
```ts
  // 异步：link 先抓 OG（填 linkDescription）→ aiSummary（copy 策略可命中）→ embedding。
  after(async () => {
    await generateAndSaveOg(snippet.id, { force: true });
    void generateAndSaveAiSummary(snippet.id);
    void generateAndSaveEmbedding(snippet.id);
  });
```

- [ ] **Step 4: PATCH 路由接线**（`src/app/api/snippets/[id]/route.ts`）

import 顶部加：
```ts
import { generateAndSaveOg } from "@/lib/snippets/link-og";
```
在 `inputChanged` 表达式里新增 linkUrl 变化检测，并捕获 `linkUrlChanged` 供 after 的 force 用。把现有：
```ts
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
    after(() => {
      void generateAndSaveAiSummary(id);
      void generateAndSaveEmbedding(id);
    });
  }
```
改为：
```ts
  const linkUrlChanged =
    rest.linkUrl !== undefined &&
    (rest.linkUrl ?? null) !== existing.linkUrl;
  const inputChanged =
    linkUrlChanged ||
    (rest.content !== undefined && rest.content !== existing.content) ||
    (rest.kind !== undefined && rest.kind !== existing.kind) ||
    (rest.quoteSource !== undefined &&
      (rest.quoteSource ?? null) !== existing.quoteSource) ||
    (rest.linkTitle !== undefined &&
      (rest.linkTitle ?? null) !== existing.linkTitle) ||
    (rest.linkDescription !== undefined &&
      (rest.linkDescription ?? null) !== existing.linkDescription);
  if (inputChanged) {
    after(async () => {
      await generateAndSaveOg(id, { force: linkUrlChanged });
      void generateAndSaveAiSummary(id);
      void generateAndSaveEmbedding(id);
    });
  }
```

- [ ] **Step 5: typecheck + build + 回归**

Run: `pnpm typecheck && pnpm build && pnpm vitest run`
Expected: 0 error / ✓ Compiled / 全部测试 PASS（含 T1 新增）。

---

### Task 3: refetch-og 端点

**Files:**
- Create: `src/app/api/snippets/[id]/refetch-og/route.ts`

- [ ] **Step 1: 写端点**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateAndSaveOg } from "@/lib/snippets/link-og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 手动重新抓取 OG：同步 await（手动动作要即时反馈），返回更新后的 snippet。 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.snippet.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "素材块不存在" }, { status: 404 });
  }
  try {
    await generateAndSaveOg(id, { force: true });
    const snippet = await prisma.snippet.findUnique({
      where: { id },
      omit: { embedding: true },
    });
    return NextResponse.json({ snippet });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "重新抓取失败" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 0 error / ✓ Compiled。

---

### Task 4: SnippetCard link 渲染升级 + 重新抓取按钮

**Files:**
- Modify: `src/components/snippets/SnippetCard.tsx`（import RefreshCw/Loader2；refetch state + handler；link 分支渲染 OG 三件套 + refetch 按钮）

- [ ] **Step 1: import 追加图标**

把既有 lucide import：
```ts
import { Pin, Trash2, Quote, Link as LinkIcon, Pencil } from "lucide-react";
```
改为：
```ts
import { Pin, Trash2, Quote, Link as LinkIcon, Pencil, RefreshCw, Loader2 } from "lucide-react";
```

- [ ] **Step 2: refetch state + handler**

在组件内（`const [editing, setEditing] = useState(false);` 附近）加：
```ts
  const [refetching, setRefetching] = useState(false);
  const [refetchMsg, setRefetchMsg] = useState<string | null>(null);

  async function handleRefetch() {
    setRefetching(true);
    setRefetchMsg(null);
    try {
      const res = await fetch(`/api/snippets/${snippet.id}/refetch-og`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "抓取失败");
      onUpdated(data.snippet);
      setRefetchMsg("✓ 已更新");
    } catch (e) {
      setRefetchMsg(e instanceof Error ? e.message : "抓取失败");
    } finally {
      setRefetching(false);
      window.setTimeout(() => setRefetchMsg(null), 2000);
    }
  }
```
（`useState` 已在文件顶部 import，确认无需追加。）

- [ ] **Step 3: link 分支渲染升级**

把现有 link 分支（`snippet.kind === "link" ? (` 起的整块）替换为：
```tsx
      ) : snippet.kind === "link" ? (
        <div className="mb-2">
          {snippet.linkImage && (
            // 原生 <img>：OG 图来自任意域，next/image 需配 remotePatterns 不划算；
            // onError 隐藏坏图，referrerPolicy 防Referer泄露。
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={snippet.linkImage}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
              className="w-full h-32 object-cover rounded-md mb-2 bg-muted"
            />
          )}
          <div className="flex items-center gap-1.5 mb-1">
            <LinkIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">
              {snippet.linkTitle || snippet.linkUrl}
            </span>
          </div>
          {snippet.linkDescription && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
              {snippet.linkDescription}
            </p>
          )}
          {snippet.linkUrl && (
            <p className="text-xs text-muted-foreground truncate">
              {snippet.linkUrl}
            </p>
          )}
          {snippet.content && (
            <p className="text-sm text-foreground/80 mt-1">{snippet.content}</p>
          )}
          {refetchMsg && (
            <p className="text-xs text-muted-foreground mt-1">{refetchMsg}</p>
          )}
        </div>
      ) : (
```

- [ ] **Step 4: 重新抓取按钮（hover 按钮栏，仅 link）**

在右上角 hover 按钮栏（`<div className="absolute top-2 right-2 ...">` 内，Pencil 编辑按钮旁），追加 refetch 按钮：
```tsx
          {snippet.kind === "link" && (
            <button
              type="button"
              onClick={() => void handleRefetch()}
              disabled={refetching}
              title="重新抓取链接信息"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {refetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
          )}
```
（位置：放在 Pencil 按钮之前或之后均可，按当前文件结构插入到该按钮栏内。）

- [ ] **Step 5: typecheck + build + lint**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: 0 error / ✓ Compiled / lint 0 errors（`<img>` 已加 eslint-disable 注释，warnings = 基线）。

- [ ] **Step 6: 手测**

1. 创建 link 素材（linkUrl 指向有 OG 的页面，如 GitHub 仓库 URL）→ 刷新 → 卡片显 title + description + 预览图。
2. 无 OG 的页面 → 卡片回落 `<title>` + linkUrl，不报错。
3. 私网 URL（`http://127.0.0.1`）→ SSRF 拒绝，字段空，不报错。
4. 「重新抓取」按钮 → 强制刷新，内联「✓ 已更新」/「抓取失败」。
5. 手填 linkTitle 后只改其他字段 → linkTitle 不被覆盖；改 linkUrl → OG 覆盖。

---

## Self-Review

**1. Spec 覆盖：**
- parseOgHtml（og→twitter→title/description 兜底）→ T1 + 测试 ✓
- fetchOgMetadata（SSRF + 重定向 + timeout + size cap + image 补全）→ T2 ✓
- generateAndSaveOg（force/填空策略，非 link 自守卫，吞错）→ T2 ✓
- after() 顺序 OG→aiSummary→embedding → T2 POST/PATCH ✓
- linkUrl 加入触发字段，force=linkUrlChanged → T2 PATCH ✓
- 卡片渲染升级（linkImage/linkDescription + url 兜底）→ T4 ✓
- 手动重新抓取按钮 + 端点 → T3 + T4 ✓
- image 远程 URL（原生 img + referrerPolicy + onError）→ T4 ✓
- 错误处理（吞错、SSRF 拒绝、after 不阻断）→ T2/T3 ✓

**2. Placeholder 扫描：** 无 TBD；fetch 参数 verbatim（10s/1MB/5跳/UA/Accept/manual redirect）；force 策略表与代码一致。

**3. 类型一致性：** `OgMeta` 在 T1 定义，T2 fetchOgMetadata 返回 `OgMeta | null`；`generateAndSaveOg(snippetId, opts?)` 签名 T2 定义、T3 refetch 端点消费 `{force:true}`。`assertSafePublicUrl` 为 async（dns.lookup），fetchHtmlSafe 已 `await`。

**4. 客户端安全：** link-og.ts（jsdom+safe-web+prisma）仅被 server route + 同模块消费；SnippetCard 只经 fetch 调 `/api/snippets/[id]/refetch-og`。无 client bundle 污染。

**5. after() 异步签名：** `after(async () => { await ...; void ...; })` —— Next 16 `after()` 接受 async 回调；`generateAndSaveAiSummary`/`generateAndSaveEmbedding` 用 `void` 并行不阻塞。

**6. lint**：`<img>` 加了 `// eslint-disable-next-line @next/next/no-img-element`（该规则本项目已降为 warn，注释进一步抑制该行）。

## Execution Handoff

Plan 完成并落盘 `docs/superpowers/plans/2026-07-08-snippets-p4-link-og.md`。

**执行方式（沿用本项目约定）：Inline（推荐）** —— 本 session 顺序跑 T1→T4，与「不自动 commit、收尾统一提交」兼容。

**确认 Inline 开跑？** 我建 `feat/snippets-p4-link-og` 子分支（从当前 `feat/snippets-p3-embedding`），从 T1 动手。
