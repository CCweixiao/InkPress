# 素材块 P3-UX Implementation Plan

> **执行方式**：内联执行（executing-plans），不 per-task commit。spec + plan + 代码全部留未提交，最后用户确认后拆 commit 提交（不 push）。

**Goal:** 原地编辑（补标签编辑缺口）+ 全局快捷弹窗（Alt+N）+ 全局搜索整合，落地 P3-UX。

**Architecture:** 纯逻辑（snippetToSearchResultItem，TDD）→ 搜索 API/GlobalSearch 加 snippets → 抽 useSnippetCreateForm hook（DRY）→ SnippetQuickDialog 全局挂载 → SnippetEditInline 原地编辑。

**Tech Stack:** Next.js App Router + React + TS + vitest + Radix Dialog + Tailwind。

**Spec:** `docs/superpowers/specs/2026-07-08-snippets-p3-ux-design.md`

## Global Constraints

- **TDD 边界**：仅 `snippetToSearchResultItem`（§18）走 vitest；§16/§17 组件层靠 typecheck + build + 手动验证
- **快捷键**：`Alt+N`（非输入态触发；输入框/textarea/contenteditable 内不触发，避免 Mac Option 插特殊字符）
- **DRY**：`SnippetCreateBar` 创建逻辑抽成 `useSnippetCreateForm`，与 `SnippetQuickDialog` 共用
- **无 toast 库**：内联反馈（state + setTimeout）
- **不 per-task commit**：全部留未提交，最后拆 docs/code 两 commit
- **client bundle 禁 Node 依赖**：hook / 纯函数不 import prisma；API 改动仅服务端
- 命令：`pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm lint`

---

## Task 1: 纯逻辑 `snippetToSearchResultItem` + 测试（TDD）

**Files:**
- Create: `src/lib/snippets/search-result.ts`
- Test: `tests/unit/snippet-search-result.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { snippetToSearchResultItem } from "@/lib/snippets/search-result";

const base = {
  id: "x1",
  title: "标题",
  content: "第一行内容\n第二行",
  kind: "text",
  tagsJson: "[]",
};

describe("snippetToSearchResultItem", () => {
  it("text：title 取 title，subtitle 含「文字 · 」+ 首行", () => {
    const r = snippetToSearchResultItem(base);
    expect(r.id).toBe("x1");
    expect(r.title).toBe("标题");
    expect(r.subtitle).toContain("文字");
    expect(r.subtitle).toContain("第一行内容");
    expect(r.href).toBe("/snippets");
  });
  it("quote：subtitle 含「引用」", () => {
    const r = snippetToSearchResultItem({ ...base, kind: "quote" });
    expect(r.subtitle).toContain("引用");
  });
  it("link：subtitle 含「链接」", () => {
    const r = snippetToSearchResultItem({ ...base, kind: "link" });
    expect(r.subtitle).toContain("链接");
  });
  it("image：subtitle 含「图文」", () => {
    const r = snippetToSearchResultItem({ ...base, kind: "image" });
    expect(r.subtitle).toContain("图文");
  });
  it("title 空时用 content 首行兜底；title+content 都空 → 无标题灵感", () => {
    expect(snippetToSearchResultItem({ ...base, title: "" }).title).toBe("第一行内容");
    expect(
      snippetToSearchResultItem({ ...base, title: "", content: "" }).title
    ).toBe("无标题灵感");
  });
  it("多行 content → subtitle 只取首行 ≤60", () => {
    const r = snippetToSearchResultItem({ ...base, content: "首行\n次行" });
    expect(r.subtitle).toContain("首行");
    expect(r.subtitle).not.toContain("次行");
  });
  it("未知 kind → subtitle 含「灵感」", () => {
    const r = snippetToSearchResultItem({ ...base, kind: "weird" });
    expect(r.subtitle).toContain("灵感");
  });
  it("href 恒 /snippets", () => {
    expect(snippetToSearchResultItem(base).href).toBe("/snippets");
  });
});
```

- [ ] **Step 2: 跑测确认失败** — `npx vitest run tests/unit/snippet-search-result.test.ts` → FAIL（模块不存在）

- [ ] **Step 3: 实现** `src/lib/snippets/search-result.ts`

```ts
export type SnippetSearchInput = {
  id: string;
  title: string;
  content: string;
  kind: string;
  tagsJson: string;
};

export type SnippetSearchResultItem = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

const KIND_LABEL: Record<string, string> = {
  text: "文字",
  quote: "引用",
  link: "链接",
  image: "图文",
};

/** 素材块 → 全局搜索结果项。纯函数，不依赖 React / prisma。 */
export function snippetToSearchResultItem(
  s: SnippetSearchInput
): SnippetSearchResultItem {
  const kindLabel = KIND_LABEL[s.kind] ?? "灵感";
  const firstLine = s.content.split("\n")[0].slice(0, 60);
  const title = s.title || firstLine || "无标题灵感";
  const subtitle = `${kindLabel} · ${firstLine || title}`;
  return { id: s.id, title, subtitle, href: "/snippets" };
}
```

- [ ] **Step 4: 跑测确认通过** → 全绿
- [ ] **Step 5: 不 commit**

---

## Task 2: `/api/search` 加 snippets

**Files:** Modify `src/app/api/search/route.ts`

**Consumes (Task 1):** `snippetToSearchResultItem`

- [ ] **Step 1: 改 route.ts**
  - `SearchResult` type + `empty` 加 `snippets: SearchResultItem[]`
  - Promise.all 加 `prisma.snippet.findMany({ where:{trashed:false}, select:{id:true,title:true,content:true,kind:true,tagsJson:true} })`
  - result 加：
    ```ts
    snippets: snippets
      .filter((s) => match(s.title) || match(s.content) || match(s.tagsJson))
      .slice(0, 20)
      .map((s) => snippetToSearchResultItem(s)),
    ```
- [ ] **Step 2: typecheck** → 0 error
- [ ] **Step 3: 不 commit**

---

## Task 3: `GlobalSearch` 加灵感分区

**Files:** Modify `src/components/common/GlobalSearch.tsx`

- [ ] **Step 1:**
  - `SearchResult` type 加 `snippets: ResultItem[]`；`EMPTY` 加 `snippets: []`
  - `total` 加 `result.snippets.length`
  - 渲染区加（在 skills 之后或前）：
    ```tsx
    {result.snippets.length > 0 && (
      <ResultSection title="灵感" icon={<Sparkles className="h-4 w-4" />} items={result.snippets} onSelect={go} />
    )}
    ```
  - placeholder 文案可加「、灵感」（可选）
- [ ] **Step 2: typecheck + build**
- [ ] **Step 3: 不 commit**

---

## Task 4: `useSnippetCreateForm` hook + 重构 SnippetCreateBar

**Files:**
- Create: `src/components/snippets/use-snippet-create-form.ts`
- Modify: `src/components/snippets/SnippetCreateBar.tsx`

- [ ] **Step 1: 实现 hook**（把 SnippetCreateBar 现有 content/tags/isSubmitting/pasting state + handleSubmit + handlePaste 搬入，行为不变）
  ```ts
  export function useSnippetCreateForm({ onCreated, existingTags }: { onCreated; existingTags?: string[] }) {
    const [content, setContent] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [pasting, setPasting] = useState(false);
    const submit = async (): Promise<boolean> => { /* POST /api/snippets {content:trim,tags}; 成功 onCreated+reset */ };
    const handlePaste = async (e) => { /* 粘贴图片 → /api/upload → kind=image 创建；非图 return false */ };
    const reset = () => { setContent(""); setTags([]); };
    const canSubmit = content.trim().length > 0 && !isSubmitting && !pasting;
    return { content, setContent, tags, setTags, isSubmitting, pasting, canSubmit, submit, handlePaste, reset, existingTags };
  }
  ```
- [ ] **Step 2: 重构 SnippetCreateBar** 为薄壳：调 hook + 现有布局（textarea + 绝对 send 按钮 + TagInput）。保留 `existingTags` prop、`onCreated` prop。
- [ ] **Step 3: typecheck + build**（确保创建栏功能不回归）
- [ ] **Step 4: 不 commit**

---

## Task 5: `SnippetQuickDialog` + 挂 layout + Alt+N

**Files:**
- Create: `src/components/snippets/SnippetQuickDialog.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: 实现 SnippetQuickDialog**
  - `open` state；`useSnippetCreateForm({ onCreated })`
  - window keydown：Alt+N（非输入态）→ setOpen(true)；cleanup
  - onCreated：setSaved(true) → setTimeout 800 → reset + setOpen(false) + 若 pathname==='/snippets' 则 router.refresh()
  - Dialog：DialogTitle「快速记录灵感」+ textarea(onPaste=handlePaste, placeholder) + TagInput + 「保存」按钮(submit, disabled=!canSubmit)；saved 时按钮变「✓ 灵感已保存」
  - 失败：hook submit 返回 false → 内联「保存失败」
- [ ] **Step 2: layout.tsx** 加 `<SnippetQuickDialog />`（与 LicenseGateDialog 并列）
- [ ] **Step 3: typecheck + build**
- [ ] **Step 4: 不 commit**

---

## Task 6: `SnippetEditInline` + SnippetCard/List/View 接入

**Files:**
- Create: `src/components/snippets/SnippetEditInline.tsx`
- Modify: `src/components/snippets/SnippetCard.tsx`、`SnippetList.tsx`、`SnippetsView.tsx`

- [ ] **Step 1: 实现 SnippetEditInline**（spec §3.3）
  - props `{ snippet, existingTags?, onSave(updated), onCancel }`
  - form state：content/tags/quoteSource/linkUrl/linkTitle（由 snippet 初始化）
  - 按 kind 渲染字段 + TagInput
  - 保存：PATCH /api/snippets/[id] body `{content, tags, quoteSource, linkUrl, linkTitle}` → onSave(updated)；失败内联「保存失败」
  - Ctrl+Enter 保存；Esc 取消
- [ ] **Step 2: 改 SnippetCard**
  - 加 `editing` state + `existingTags` prop
  - hover 操作区加铅笔按钮（Pencil）→ setEditing(true)
  - editing 时正文区替换为 `<SnippetEditInline snippet existingTags onSave={(u)=>{setEditing(false); onUpdated(u);}} onCancel={()=>setEditing(false)} />`，隐藏 pin/delete
- [ ] **Step 3: 改 SnippetList** 透传 `existingTags` 给 SnippetCard
- [ ] **Step 4: 改 SnippetsView** 传 `existingTags={tags.map(t=>t.name)}` 给 SnippetList
- [ ] **Step 5: typecheck + build**
- [ ] **Step 6: 不 commit**

---

## Task 7: 全量构建验证（gate）

- [ ] `pnpm typecheck` → 0 error
- [ ] `pnpm test` → 全绿（含新增 snippet-search-result）
- [ ] `pnpm build` → SUCCESS
- [ ] `pnpm lint` → 0 error（warning 不新增）
- [ ] 报告改动 + 结果；**不 commit**，等用户确认后拆 docs/code 两 commit

---

## Notes
- Alt+N 监听必须在输入态（INPUT/TEXTAREA/contenteditable）跳过 —— Mac Option+N 在输入框会插 `˜`。
- 抽 hook 后务必手动验创建栏不回归（P2-15 刚动过）。
- SnippetEditInline 保存只发可编辑字段；title 由后端从 content 首行重算（API 已有逻辑）。
