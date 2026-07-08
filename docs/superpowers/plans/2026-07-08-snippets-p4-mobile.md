# 素材块 P4-24（/snippets 移动端）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans（inline）按 task 执行。**本项目约束：不自动 commit，全部完成后用户发话再统一提交。** 各 task 仅以 typecheck / build / lint / 手测作 gate。

**Goal:** /snippets 页移动端可用（卡片操作常显、标签 chips 行筛选、边距），**桌面端 ≥md 逐像素不变**。

**Architecture:** 纯 Tailwind 响应式 + 复用 `resolveTagColor`/`getTagColorClasses`。所有移动端行为 `md:`/`sm:` 门控，base class 不改桌面效果。

**Tech Stack:** Next 16.2.9 · Tailwind 断点（sm=640/md=768）· 零新依赖。

**Spec:** `docs/superpowers/specs/2026-07-08-snippets-p4-mobile-design.md`

## Global Constraints

- **不自动 commit**。
- **桌面端零回归（最高约束）**：所有改动用 `md:`/`sm:` 门控；不带断点的 base class 在 ≥md/≥sm 的渲染必须与现状一致。改完桌面视口回归手测。
- **客户端安全**：零 prisma / 零新依赖；复用已有颜色纯函数。
- **TDD 边界**：纯布局，无新纯逻辑 → 不新增 vitest。

## Pre-flight

- 分支：从当前 `feat/snippets-p4-batch-ops` 开 stacked 子分支 `feat/snippets-p4-mobile`。

---

### Task 1: SnippetCard 操作栏移动端常显 + page.tsx 边距

**Files:**
- Modify: `src/components/snippets/SnippetCard.tsx`
- Modify: `src/app/snippets/page.tsx`

- [ ] **Step 1: SnippetCard 操作栏可见性 + 磨砂底**

把操作栏容器 className（`!selectMode &&` 内的 `<div className="absolute top-2 right-2 ...">`）：

旧：
```
absolute top-2 right-2 flex items-center gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100 transition-opacity
```
新：
```
absolute top-2 right-2 flex items-center gap-1 rounded-md bg-background/70 backdrop-blur-sm md:bg-transparent md:backdrop-blur-none opacity-100 focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity
```

要点：
- `opacity-100` 为移动端 base；`md:opacity-0 md:group-hover:opacity-100` 还原桌面 hover 行为；`focus-within:opacity-100` 保留给键盘用户。
- `bg-background/70 backdrop-blur-sm rounded-md` 仅移动端磨砂底（盖图片可读），`md:bg-transparent md:backdrop-blur-none` 桌面透明如初。

- [ ] **Step 2: SnippetCard 操作按钮触控区**

4 个操作按钮（refetch / 编辑 / 置顶 / 删除）共用前缀 `"p-1 rounded hover:`。`replace_all`：

旧：`"p-1 rounded hover:`
新：`"p-1.5 md:p-1 rounded hover:`

（移动端 p-1.5 放大触控区，桌面 md:p-1 不变。）

- [ ] **Step 3: page.tsx 边距**

`replace_all` `max-w-6xl px-6 ` → `max-w-6xl px-4 sm:px-6 `（命中 header 内层 div 与 main 两处；`<sm` 用 px-4，`≥sm` 还原 px-6）。

- [ ] **Step 4: typecheck + build + lint**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: 0 error / ✓ Compiled / lint 0 errors（既有 warning 不计）。

- [ ] **Step 5: 桌面回归手测（≥md）**
- 卡片 hover 才显操作栏，移开隐藏；键盘 focus 显。
- 操作按钮尺寸与改前一致（p-1）。
- 标签侧栏正常；page 边距 px-6 不变。

---

### Task 2: SnippetsView 标签 chips 行

**Files:**
- Modify: `src/components/snippets/SnippetsView.tsx`

- [ ] **Step 1: import 追加**

- lucide：`import { Pin, Trash2 } from "lucide-react";` → `import { Pin, Trash2, Hash } from "lucide-react";`
- tag-colors：`import { isValidTagColor } from "@/lib/snippets/tag-colors";` → `import { isValidTagColor, resolveTagColor, getTagColorClasses } from "@/lib/snippets/tag-colors";`
- 新增：`import { cn } from "@/lib/utils";`

- [ ] **Step 2: 插入 md:hidden 标签 chips 行**

在类型筛选 `</div>` 之后、`{/* 搜索框 */}` 之前插入：
```tsx
        {/* 移动端标签筛选（横向滚动 chips，桌面用侧栏） */}
        {tags.length > 0 && (
          <div className="md:hidden -mt-3 flex gap-2 overflow-x-auto flex-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tags.map(({ name, count }) => {
              const cls = getTagColorClasses(resolveTagColor(name, tagColors));
              const active = activeTags.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleToggleTag(name)}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs whitespace-nowrap",
                    active ? cls.active : "border-border text-muted-foreground"
                  )}
                >
                  <Hash className="h-3 w-3" />
                  {name}
                  <span className="opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        )}
```

要点：
- `md:hidden`——桌面不渲染，侧栏仍 `hidden md:block`，互不干扰。
- `handleToggleTag` / `activeTags` / `tagColors` 均为组件既有（与侧栏同源状态）。
- 横向滚动 + 隐藏滚动条（`[scrollbar-width:none]` + webkit 伪元素）。

- [ ] **Step 3: typecheck + build + lint**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: 0 error / ✓ Compiled / lint 0 errors。

- [ ] **Step 4: 手测**
- 桌面（≥md）：chips 行不可见，侧栏正常，筛选状态一致。
- 移动（DevTools 375px）：chips 行横向滚动；点 chip 筛选（active 高亮带标签色）；与侧栏状态联动（切桌面视口一致）。
- 卡片操作栏常显可点；批量工具栏窄屏换行不溢出。

---

## Self-Review

**1. Spec 覆盖：** 卡片操作移动端常显（T1）+ 标签 chips 行（T2）+ 边距（T1）+ 批量工具栏自适应（无需改，已 flex-wrap）✓。

**2. 桌面零回归核验：**
- SnippetCard 可见性：`md:opacity-0 md:group-hover:opacity-100` + `md:bg-transparent md:backdrop-blur-none` → ≥md 与原 `opacity-0 group-hover:opacity-100`（无底）逐像素一致 ✓。
- SnippetCard 按钮：`md:p-1` → ≥md 与原 `p-1` 一致 ✓。
- page 边距：`sm:px-6` → ≥sm（含桌面）px-6 一致 ✓。
- chips 行：`md:hidden` → ≥md 不渲染 ✓。

**3. Placeholder：** 无；所有 class 字符串 verbatim。

**4. 客户端安全：** 仅 Tailwind class + 复用 `@/lib/snippets/tag-colors`（纯）+ `@/lib/utils` 的 `cn`（纯）。零 prisma。

**5. 颜色回落：** `resolveTagColor` 返 null 时 `getTagColorClasses(null)` 回落 slate（`bg-primary/10 text-primary border-primary/30`）——active chip 仍有清晰高亮 ✓。

## Execution Handoff

Plan 完成并落盘 `docs/superpowers/plans/2026-07-08-snippets-p4-mobile.md`。**Inline 执行**，T1 → T2。
