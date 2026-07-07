# Review 指引 · 主题多渠道适配 + 客户端 bundle 修复

> **日期**：2026-07-03
> **基线 commit**：`b636e3f` Add article import and export actions
> **改动范围**：13 文件（3 改 + 10 新增），净 **−421 行**
> **分支**：`main`（未提交）

---

## 1. 改动概述

一次未提交改动，含两个递进部分（B 是 A 的修复）：

| 部分 | 目标 | 关键产物 |
|---|---|---|
| **A. 主题管道拆分 + 多渠道注册表** | 把通用 markdown 美化从微信管道剥离，做成声明式渠道注册表 | `renderInlineHtml`、`channels/`、`PublishEntryDialog` |
| **B. 客户端 bundle fs 修复** | 修复 A 引入的"客户端拉入 better-sqlite3" | `channels/` 拆 `meta`（客户端）/ `finalize`（服务端） |

## 2. 改动清单

### 新增（10）

| 文件 | 角色 | 客户端可用 |
|---|---|---|
| `src/lib/convert/render-inline.ts` | 通用渲染层（步骤 1/3/4/5/6 + `BASE_CSS`） | ❌ 含 prisma 链 |
| `src/lib/convert/html-sanitize.ts` | `stripUnsafeTags` + `inlineImageDimensions`（正则） | ❌ |
| `src/lib/publish/channels/types.ts` | `ChannelMeta` / `ChannelFinalize` 类型 | ✅（type 擦除） |
| `src/lib/publish/channels/meta.ts` | 渠道元数据注册表（5 渠道） | ✅ |
| `src/lib/publish/channels/finalize.ts` | `getFinalize` + `FINALIZERS` map | ❌ |
| `src/lib/publish/channels/index.ts` | 服务端便利入口（re-export） | ❌ |
| `src/components/publish/PublishEntryDialog.tsx` | 渠道选择器 + 路由 | ✅ |
| `src/components/publish/WechatPublishPanel.tsx` | 从 PublishDialog 抽出的微信面板 | ✅ |
| `src/components/publish/ExportHtmlPanel.tsx` | 导出可粘贴 HTML 面板 | ✅ |
| `docs/publish-driver-design.md` | 未来"一键发布"RFC（本次不实施） | — |

### 修改（3）

- `src/lib/convert/to-wechat.ts`（−84）— `convertToWeChat` 内部改 `renderInlineHtml + finalizeForWeChat`，`cleanForWeChat` 改名并 export，删 `BASE_CSS`
- `src/app/api/preview/route.ts`（+37）— 加 `channel` 参数（默认 `wechat`），调 `getFinalize`
- `src/components/publish/PublishDialog.tsx`（−404）— 薄壳代理 `PublishEntryDialog`，对外 9 props 不变

### 不动（回归保证）

`src/app/api/wechat/draft/route.ts`、`prisma/schema.prisma`、`themes/**`、`EditorWorkspace.tsx` 调用点——刻意保留，确保微信发布零回归。

## 3. 关键设计决策（Review 重点）

### 3.1 `renderInlineHtml` 等价性（P0）

从 `convertToWeChat` 抽出步骤 1/3/4/5/6（剥 fm → markdown-it → 拼 `<div id="nice">`+4 段 `<style>` → `resolveCssVariables` → juice 全内联）。

- **等价性保证**：`wrappedHtml` 模板与原 `to-wechat.ts` 步骤4 字面一致 + 同 juice 配置（`inlinePseudoElements/preserveImportant/resolveCSSVariables:false`）
- **刻意保留 4 段 `<style>`**：由各渠道 finalize 决定是否清除（微信用 jsdom 删，通用用正则删），保证两路径进入后处理前 HTML 一致
- **已验证**：`git stash` 对比 `convertToWeChat` 输出，HASH `cd4473...` 一致、HTML diff 为空
- ⚠️ **核对点**：`renderInlineHtml` 的 `wrappedHtml` 与原步骤4 是否字面一致；juice 配置是否完全照搬

### 3.2 `finalizeForWeChat` = 原 `cleanForWeChat`（P0）

仅重命名 + 加 `export`，内部逻辑（`normalizeImageRowsForWeChat` / `normalizeListsForWeChat` / 锚点清理 / 首尾空 p）**一字未改**。

⚠️ 核对点：微信专有的列表 section 化、首尾空 p 占位等逻辑是否原样保留。

### 3.3 `channel.finalize` 分流（P1）

- `wechat` → `finalizeForWeChat`（列表 section 化、首尾空 p）
- `zhihu`/`juejin`/`bokeyuan`/`generic` → `finalizeForExport`（`stripUnsafeTags` + `inlineImageDimensions`，**保留原生 ul/ol/li、锚点**）
- 已验证：5 渠道 smoke 断言通过

⚠️ 核对点：通用渠道是否真的不做 section 化（对知乎/掘金有害、丢失列表语义）。

### 3.4 `meta` / `finalize` 拆分（P0，B 部分核心）

- 客户端组件只 `import from "@/lib/publish/channels/meta"`（纯数据 + lucide 图标）
- `finalize.ts` 仅服务端 import（依赖 `to-wechat → render-inline → themes/loader → prisma`）
- 已验证：`grep -rn "@/lib/db|themes/loader|convert/to-wechat|channels/finalize" src/components/` 零命中

⚠️ 核对点：客户端组件（`PublishEntryDialog`/`ExportHtmlPanel`/`WechatPublishPanel`/`PublishDialog`）的 import 路径是否只指向 `channels/meta`。

### 3.5 `PublishDialog` 薄壳（P2）

对外 9 props 不变 → `EditorWorkspace.tsx:383` 调用点零改动。内部委托 `PublishEntryDialog`。

⚠️ 核对点：props 透传链 `PublishDialog → PublishEntryDialog → WechatPublishPanel/ExportHtmlPanel` 是否完整（尤其 `themes`/`defaultThemeId`）。

## 4. 已验证

| 验证 | 方法 | 结果 |
|---|---|---|
| 微信路径等价性 | `git stash` + diff `convertToWeChat` 输出 | ✅ HASH 一致 |
| 渠道 finalize 分流 | tsx 脚本跑 5 渠道 + unknown 兜底断言 | ✅ 全过 |
| TypeScript | `pnpm typecheck`（tsc --noEmit） | ✅ 通过 |
| ESLint | 新/改 9 文件 | ✅ 0 error 0 warning |
| 客户端 bundle 隔离 | grep `src/components` Node 依赖 | ✅ 零命中 |

## 5. Review 重点（按优先级）

1. **P0 等价性**：`renderInlineHtml` 是否真与原 `to-wechat` 步骤3-6 逐字符等价
2. **P0 bundle 隔离**：客户端 import 链绝对不含 prisma/better-sqlite3/themes/loader/to-wechat
3. **P1 渠道分流**：各渠道 finalize 后处理是否符合预期
4. **P2 薄壳透传**：props 传递完整性
5. **P2 UI 行为**：渠道选择器、返回、发布/复制 HTML 流程（建议手测）

## 6. 未做 / 已知限制

- **未真机测试**：通用渠道 HTML 未实际粘贴到知乎/掘金验证（建议手测或后续补）
- **阶段4 未做**：`WeChatPreview` 未加 `channel` prop，编辑器预览仍默认微信（不影响发布功能）
- **`docs/publish-driver-design.md`**：未来"一键发布 driver"的 RFC，本次不实施

## 7. 相关

- 实施记忆：`[[client-bundle-no-node-deps]]`（本次踩的坑及防范）
- 设计溯源：`.claude/plans/atomic-orbiting-sifakis.md`
- 未来迭代：`docs/publish-driver-design.md`
