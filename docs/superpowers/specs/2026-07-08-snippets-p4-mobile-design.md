# 素材块 P4-24（/snippets 移动端）设计

> 日期：2026-07-08
> 分支：`feat/snippets-p4-mobile`（从 `feat/snippets-p4-batch-ops` 开 stacked 子分支）
> 范围：路线图 P4 的 **item 24**（移动端兼容），**仅 /snippets 页**（编辑器 @面板本轮不动）。

## 目标

让 /snippets 页在手机端可用：卡片操作够得着、有标签筛选、布局不挤。**桌面端（≥md）渲染与交互逐像素不变**——所有移动端行为用 `md:`/`sm:` 断点门控，base class 不改桌面效果。

## 背景与现状（桌面优先前提下的缺口）

- **卡片操作 hover-only**：`SnippetCard` 操作栏 `opacity-0 focus-within:opacity-100 group-hover:opacity-100`——触屏无 hover → 移动端编辑/置顶/删除/重抓**够不着**。桌面端该交互正确，不能动。
- **标签侧栏 `hidden md:block`**：移动端整个隐藏 → **无标签筛选**。桌面侧栏正确，保留。
- **瀑布流已响应式**：`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`——无需改。
- **批量工具栏**：select 模式 6 按钮，外层 `flex flex-wrap` 已能换行——不强行横滚，保持简单。
- **颜色工具**：`resolveTagColor(tag, tagColors)` + `getTagColorClasses(color)`（`@/lib/snippets/tag-colors`），null 自动回落 slate。chips 复用。
- 全局 viewport 由 Next 默认注入，无需补。

## 关键设计决策（已与用户确认）

1. **范围仅 /snippets 页**（编辑器 @面板绑定编辑器整体移动端改造，本轮排除）。
2. **卡片操作 = 移动端常显**（非 ⋯ 菜单）：`md:` 门控让 <md 常显、≥md 保持 hover。
3. **标签筛选 = 横向滚动 chips 行**（`md:hidden`）：与侧栏共享 `activeTags`，桌面不显示。
4. **桌面端零回归**：所有改动断点门控，改完桌面视口回归验证。

## 数据模型

无变更。

## 架构

```
SnippetCard 操作栏：
  opacity-0 group-hover:opacity-100                    （现状·桌面）
  → opacity-100 md:opacity-0 md:group-hover:opacity-100 （移动常显·桌面不变）
  + 容器 bg-background/70 backdrop-blur-sm rounded-md md:bg-transparent md:backdrop-blur-none
  + 按钮 p-1.5 md:p-1

SnippetsView（类型筛选行下方，md:hidden）：
  tags.length>0 → flex overflow-x-auto（隐藏滚动条）的 #tag chips
    chip active → getTagColorClasses(resolveTagColor(name,tagColors)).active
    点击 → handleToggleTag(name)（与侧栏同一 activeTags）

page.tsx：px-6 → px-4 sm:px-6（<640 留呼吸，≥sm 不变）
```

### 模块布局

| 文件 | 改动 | 桌面影响 |
|---|---|---|
| `src/components/snippets/SnippetCard.tsx`（改） | 操作栏移动端常显 + 磨砂底 + 触控区 | 无（`md:` 门控，≥md 与现状一致） |
| `src/components/snippets/SnippetsView.tsx`（改） | 新增 `md:hidden` 标签 chips 行 | 无（≥md 不渲染） |
| `src/app/snippets/page.tsx`（改） | `px-6` → `px-4 sm:px-6` | 无（≥sm 仍 px-6） |

**客户端安全**：零新依赖、零 prisma；纯 Tailwind 响应式 + 复用已有颜色纯函数。

## 行为规约

### SnippetCard 操作栏

- 容器 `<div className="absolute top-2 right-2 ...">` className 调整：
  - 可见性：`opacity-100 focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100`（替换原 `opacity-0 focus-within:opacity-100 group-hover:opacity-100`）。
  - 磨砂底（仅移动）：追加 `bg-background/70 backdrop-blur-sm rounded-md md:bg-transparent md:backdrop-blur-none`。
- 内部各操作按钮：`p-1` → `p-1.5 md:p-1`（移动端放大触控区，桌面端尺寸不变）。
- selectMode 分支（`!selectMode && (...)`）不变——移动端选中态仍显 checkbox、隐操作栏。

### SnippetsView 标签 chips 行

- 类型筛选 `<div>` 之后、搜索框之前，插入：
  ```tsx
  {tags.length > 0 && (
    <div className="md:hidden -mt-3 flex gap-2 overflow-x-auto flex-nowrap pb-1
                    [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tags.map(({ name, count }) => {
        const cls = getTagColorClasses(resolveTagColor(name, tagColors));
        const active = activeTags.includes(name);
        return (
          <button key={name} type="button"
            onClick={() => handleToggleTag(name)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs whitespace-nowrap",
              active ? cls.active : "border-border text-muted-foreground"
            )}>
            <Hash className="h-3 w-3" />
            {name}
            <span className="opacity-60">{count}</span>
          </button>
        );
      })}
    </div>
  )}
  ```
- import 追加：`Hash`（lucide）、`resolveTagColor, getTagColorClasses`（`@/lib/snippets/tag-colors`，与既有 `isValidTagColor` 同模块）、`cn`（`@/lib/utils`）。
- 与侧栏共享 `activeTags` / `handleToggleTag`——同一筛选状态，桌面侧栏与移动 chips 互不干扰（不同视口各显其一）。

### page.tsx 边距

- `<main className="mx-auto max-w-6xl px-6 py-8">` → `px-4 sm:px-6`（`max-w-6xl py-8` 不变）。header 同理 `px-6` → `px-4 sm:px-6`。

## 错误处理

纯前端布局，无运行时错误路径。chips 复用既有 `handleToggleTag`（已有乐观更新 + 失败回滚）。

## 测试边界

**无新纯逻辑** → 不新增 vitest。gate = typecheck + build + lint + **桌面视口回归手测** + 移动视口手测。

## 验收

**桌面端回归（≥md，必须与改前一致）：**
1. 卡片 hover 才显操作栏；移开隐藏；键盘 focus 显。
2. 标签侧栏正常显示、可筛选/设色；chips 行不可见。
3. 边距 px-6 不变。

**移动端（<md，DevTools 375px）：**
4. 卡片操作栏常显（磨砂底），可点编辑/置顶/删除/（link）重抓。
5. 标签 chips 行横向滚动，点 chip 筛选（active 高亮），与侧栏状态联动（转桌面视口可见一致）。
6. 批量工具栏窄屏自然换行不溢出。
7. 卡片单列；创建栏/搜索框全宽可用。

## 范围外（本轮不做）

- 编辑器 @面板（SnippetMentionPopover / SnippetInsertPanel）移动端。
- 卡片「⋯」溢出菜单（采用常显方案）。
- 标签颜色设置移到移动 chips（仍走桌面侧栏）。
- swipe 手势、底部 tabbar 等原生 App 模式。
