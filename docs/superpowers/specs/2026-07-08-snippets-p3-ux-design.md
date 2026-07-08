# 素材块 P3-UX：原地编辑 + 全局快捷弹窗 + 全局搜索整合

- **日期**：2026-07-08
- **范围**：P3 item 16（原地编辑）/ 17（全局快捷弹窗 Alt+N）/ 18（全局搜索整合）
- **TDD 边界**：仅 `snippetToSearchResultItem` 纯函数（§18）。§16/§17 是组件/集成，靠 typecheck + build + 手动验证（沿用 P1/P2 「纯逻辑层才 TDD」边界）
- **上游设计文档**：`docs/features/snippets-design.md` §4.2 / §2.3 / §4.5 / §9 / §10 P3
- **上一轮**：P2-15 标签系统（已 commit 在 `feat/snippets-p2-tag-system`）

---

## 1. 目标与非目标

### 目标
1. **P3-16 原地编辑**：卡片 hover「铅笔」→ 原地展开编辑态（content + kind 专属字段 + tags），Ctrl+Enter / 保存按钮 PATCH。**补 P2-15 的缺口**（现只能创建时设标签，已有 snippet 无法改）。
2. **P3-17 全局快捷弹窗**：根 layout 挂全局组件，`Alt+N` 呼出 Dialog 快速记录（与创建栏同逻辑），成功后关闭 + 若在 `/snippets` 则刷新列表。
3. **P3-18 全局搜索整合**：`/api/search` 加 `snippets` 类别；`GlobalSearch` 加「灵感」分区。

### 非目标（本轮不做）
- 编辑时切换 kind（结构性变更，留以后）
- image snippet 替换图片（要走上传流，留 P4）
- 标签重命名/删除跨 snippet 级联（留 P4-21）
- 快捷键可配置（本轮固定 Alt+N）
- 全局搜索结果高亮匹配文字（现 GlobalSearch 未做高亮，保持一致）

### 偏差说明
- **快捷键偏差**：设计文档 §2.3 写 `Cmd/Ctrl+Shift+N`，但该组合是浏览器「无痕窗口」快捷键，网页**无法拦截**。改用 **`Alt+N`**（Mac Option+N，跨平台无浏览器占用）。
- **§16 触发偏差**：设计文档 §4.2 写「点击卡片 → 展开编辑态」；改为 hover「铅笔」按钮触发，避免与卡片内文字选择 / 链接点击冲突。

---

## 2. 背景与现状（已 Explore 确认）

| 关注点 | 现状 | 本轮 |
|--------|------|------|
| `SnippetCard.tsx` | 只读，hover 有 pin/delete | 加 hover 铅笔 → 编辑态切换 |
| `SnippetCreateBar.tsx` | 内联创建逻辑（content/tags/paste/submit） | 抽成 `useSnippetCreateForm` hook，与弹窗共用 |
| `/api/snippets/[id]` PATCH | 已支持全字段（title/content/kind/tags/quoteSource/linkUrl/...） | 直接复用，不动 |
| 根 `app/layout.tsx` | 挂 `LicenseGateDialog` / `UpdateNotification`（client） | 加挂 `SnippetQuickDialog` |
| 全局 keydown 模式 | `ArticleDiffDialog` 用 `window.addEventListener("keydown", ...)` + cleanup | 镜像 |
| `GlobalSearch.tsx` | `/api/search` → `{articles,spaces,assets,skills}`，分区渲染 | 加 `snippets` 分区 |
| `/api/search/route.ts` | match(title/digest...) 子串，slice 20 | 加 snippets 查询 + `snippetToSearchResultItem` |
| `Dialog` 原语 | Radix，`Dialog/DialogContent/DialogHeader/DialogTitle/...` | 复用 |
| toast 库 | **无** | 内联反馈（ArticleMaterialsPanel 模式） |

---

## 3. P3-16 原地编辑

### 3.1 触发与态切换
- `SnippetCard` 加本地 `editing: boolean` state。
- hover 操作区加「铅笔」按钮（Pencil 图标，与 pin/delete 并列）；点击 → `setEditing(true)`。
- 编辑态：卡片正文区替换为 `<SnippetEditInline>`；hover 操作区隐藏 pin/delete，改由 EditInline 内部的「保存/取消」接管。

### 3.2 可编辑字段（按 kind）
| kind | 可编辑字段 |
|------|-----------|
| text | content（textarea） |
| quote | content + quoteSource |
| link | linkUrl + linkTitle + content（备注） |
| image | content（caption）；**imageUrl 不改** |

所有 kind 共有：**tags**（复用 `TagInput`，`existingTags` 由 SnippetsView 透传）。**kind 本身不可改**。

### 3.3 `SnippetEditInline.tsx`（新）
```tsx
interface SnippetEditInlineProps {
  snippet: SnippetItem;
  existingTags?: string[];
  onSave: (updated: SnippetItem) => void;  // 成功后回传最新 snippet
  onCancel: () => void;
}
```
- 本地 form state 由 snippet 初始化（content / tags / quoteSource / linkUrl / linkTitle）。
- 按 kind 渲染对应字段 + TagInput。
- 「保存」/ Ctrl+Enter → `PATCH /api/snippets/[id]` body `{ content, tags, quoteSource, linkUrl, linkTitle }`（仅这些字段；title 由后端从 content 首行重算）→ 成功 `onSave(updated)`；失败内联「保存失败」。
- 「取消」/ Esc → `onCancel()`（丢弃改动）。
- 提交中 disable 按钮 + spinner。

### 3.4 SnippetCard 接入
- props 加 `existingTags?: string[]`（透传给 EditInline 的 TagInput suggestions）。
- `onUpdated` 已存在 —— EditInline 的 onSave → `setEditing(false)` + 调父级 onUpdated。
- `onCancel` → `setEditing(false)`。

---

## 4. P3-17 全局快捷弹窗

### 4.1 `useSnippetCreateForm` hook（抽自 SnippetCreateBar，DRY）
**文件**：`src/components/snippets/use-snippet-create-form.ts`

```ts
interface UseSnippetCreateFormOptions {
  onCreated: (snippet: SnippetItem) => void;
  existingTags?: string[];
}
function useSnippetCreateForm({ onCreated, existingTags }: UseSnippetCreateFormOptions) {
  // 返回：
  return {
    content, setContent,
    tags, setTags,
    isSubmitting,
    pasting,
    canSubmit,        // content.trim() && !isSubmitting && !pasting
    submit,           // async () => Promise<boolean>（成功 true）
    handlePaste,      // (e: ClipboardEvent<HTMLTextAreaElement>) => Promise<void>
    reset,            // 清 content + tags
    existingTags,     // 透传给内部 TagInput
  };
}
```
- 内部封装：POST `/api/snippets`（content+tags）、粘贴图片走 `/api/upload` + kind=image 创建（逻辑搬自现 SnippetCreateBar，行为不变）。
- 客户端安全：仅 fetch + useState，无 prisma。
- `SnippetCreateBar` 重构为薄壳：用此 hook + 现有布局（textarea + 绝对定位 send 按钮 + TagInput）。

### 4.2 `SnippetQuickDialog.tsx`（新，全局）
**文件**：`src/components/snippets/SnippetQuickDialog.tsx`

```tsx
export function SnippetQuickDialog() {
  // 无 props；自包含
}
```
- `open` state；`useSnippetCreateForm({ onCreated: handleCreated })`。
- **Alt+N 监听**（window keydown，镜像 ArticleDiffDialog）：
  ```ts
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    // 输入态不触发（避免 Option+N 在输入框插特殊字符 + 误触）
    if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
    if (e.altKey && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      setOpen(true);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
  ```
- **Dialog 内容**：DialogTitle「快速记录灵感」+ content textarea（onPaste=handlePaste）+ TagInput + 「保存」按钮（submit）。
- **成功流**：submit 成功 → 内联「✓ 灵感已保存」~800ms → `reset()` + `setOpen(false)`；若 `pathname === "/snippets"` 则 `router.refresh()` 列表刷新。
- 顶栏/各处**不放触发按钮**（本轮仅快捷键；按钮入口留以后）—— 用户选的是「快捷键」方案。

### 4.3 挂载
根 `app/layout.tsx` 在 `<LicenseGateDialog />` 旁加 `<SnippetQuickDialog />`。

---

## 5. P3-18 全局搜索整合

### 5.1 纯逻辑 `snippetToSearchResultItem`（TDD）
**文件**：`src/lib/snippets/search-result.ts`

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
/** 素材块 → 全局搜索结果项。纯函数，不依赖 React / prisma。 */
export function snippetToSearchResultItem(s: SnippetSearchInput): SnippetSearchResultItem;
```
映射：title = `s.title || content 首行 || "无标题灵感"`；subtitle = `${kindLabel} · ${content 首行(≤60)}`（kindLabel: text→文字/quote→引用/link→链接/image→图文/其他→灵感）；href 恒 `/snippets`。

**测试**（`tests/unit/snippet-search-result.test.ts`）：
- text：title 取 title；subtitle 含「文字 · 」+ 首行
- quote：subtitle 含「引用 · 」
- link：title 取 linkTitle||title；subtitle 含「链接 · 」
- image：subtitle 含「图文 · 」
- title 空 + content 空 → title「无标题灵感」，不崩
- content 多行 → subtitle 只取首行 ≤60
- href 恒 `/snippets`
- 未知 kind → subtitle 含「灵感 · 」

### 5.2 `/api/search/route.ts` 改
- `SearchResult` type 加 `snippets: SearchResultItem[]`；`empty` 加 `snippets: []`。
- Promise.all 加 `prisma.snippet.findMany({ where:{trashed:false}, select:{id,title,content,kind,tagsJson} })`。
- result.snippets = 过滤 `match(title)||match(content)||match(tagsJson)` → slice 20 → `snippetToSearchResultItem`。

### 5.3 `GlobalSearch.tsx` 改
- `SearchResult` type 加 `snippets`；`EMPTY` 加 `snippets: []`；`total` 加 snippets.length。
- 加「灵感」ResultSection（Sparkles 图标，`onSelect={go}`，go('/snippets')）。

---

## 6. 组件契约汇总

| 文件 | 改动 |
|------|------|
| `SnippetEditInline.tsx`（新） | §3.3 |
| `SnippetCard.tsx`（改） | editing state + 铅笔按钮 + 编辑态渲染 EditInline + existingTags 透传 |
| `SnippetList.tsx`（改） | 透传 existingTags 给 SnippetCard |
| `SnippetsView.tsx`（改） | 传 existingTags（= tags.map(name)）给 SnippetList |
| `use-snippet-create-form.ts`（新） | §4.1 hook |
| `SnippetCreateBar.tsx`（改） | 重构为薄壳用 hook |
| `SnippetQuickDialog.tsx`（新） | §4.2 |
| `app/layout.tsx`（改） | 挂 SnippetQuickDialog |
| `search-result.ts`（新） | §5.1 纯函数 |
| `api/search/route.ts`（改） | §5.2 加 snippets |
| `GlobalSearch.tsx`（改） | §5.3 加灵感分区 |
| `snippet-search-result.test.ts`（新） | §5.1 测试 |

---

## 7. 数据流

**原地编辑**：hover 铅笔 → EditInline → PATCH → onSave(updated) → SnippetCard setEditing(false) + onUpdated → SnippetsView 更新该 snippet。

**快捷弹窗**：Alt+N（非输入态）→ open → 填写 → submit → POST → 成功「✓ 已保存」→ 关闭 + reset；在 /snippets 则 router.refresh。

**全局搜索**：GlobalSearch 输入 → /api/search → 含 snippets → 点灵感项 → go('/snippets')。

---

## 8. 边界与错误

| 场景 | 行为 |
|------|------|
| Alt+N 在输入框/textarea/contenteditable 内 | **不触发**（避免插特殊字符 + 误触） |
| 编辑保存失败 | 内联「保存失败」，留在编辑态 |
| 编辑取消 | 丢弃改动，回只读 |
| 弹窗提交中再按 Alt+N | 忽略（dialog 已开） |
| 弹窗 POST 失败 | 内联「保存失败」，留弹窗不关 |
| 全局搜索 q<2 字符 | snippets 空（同其他类别） |
| 无匹配 snippet | 不渲染灵感分区（同其他类别 `> 0 &&`） |

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Alt+N 与 Mac Option 特殊字符 | 输入态不触发；非输入态 OS 不插字符 |
| 抽 hook 重构 SnippetCreateBar 引入回归 | 行为对齐（paste/submit/disabled 逻辑不变）；build + 手动验创建栏 |
| EditInline 与 SnippetCard 状态纠缠 | 编辑态自包含于 EditInline；SnippetCard 只持 editing 布尔 |
| /api/search 加 snippets 拖慢 | snippet 表小 + 已有索引；select 精简 5 字段；slice 20 |
| router.refresh 在非 /snippets 路由 | 仅 pathname==='/snippets' 时调 |

---

## 10. 手动验证清单（browser）

**A. 原地编辑（§16）**
- [ ] 卡片 hover 出现铅笔；点击 → 原地展开编辑态
- [ ] 改 content + 加/删 tag（TagInput）+ 改 quoteSource/linkUrl → 保存 → 卡片更新；onUpdated 透传
- [ ] Esc / 取消 → 丢弃改动回只读
- [ ] 保存失败（断网）→ 内联「保存失败」留编辑态
- [ ] image 卡只能改 caption，不能换图

**B. 快捷弹窗（§17）**
- [ ] 任意非输入位置按 Alt+N → 弹窗开
- [ ] 在 textarea/输入框内按 Alt+N → 不触发（且不插字符）
- [ ] 填 content + tag + 粘贴图片 → 保存 → 「✓ 已保存」→ 关闭
- [ ] 在 /snippets 页按 Alt+N 创建 → 列表刷新出新卡
- [ ] POST 失败 → 「保存失败」留弹窗
- [ ] 创建栏（/snippets 页）功能不回归（抽 hook 后）

**C. 全局搜索（§18）**
- [ ] 顶栏搜索 → 输入能匹配 snippet 的词 → 出现「灵感」分区
- [ ] 点灵感项 → 跳 /snippets
- [ ] 其他类别（文章/空间/素材/技能）不回归

**D. 构建**
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm lint` 通过

---

## 11. 实现顺序（建议）
1. 纯逻辑 TDD：`snippetToSearchResultItem` + 测试（§5.1）
2. §18 API：`/api/search` 加 snippets（§5.2）
3. §18 GlobalSearch：加灵感分区（§5.3）
4. §17 `useSnippetCreateForm` hook + 重构 SnippetCreateBar（§4.1）
5. §17 `SnippetQuickDialog` + 挂 layout + Alt+N（§4.2/4.3）
6. §16 `SnippetEditInline` + SnippetCard/List/View 接入（§3）
7. 全量构建 + 清单 D
