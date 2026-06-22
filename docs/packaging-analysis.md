# InkPress DMG 打包机制分析与架构评估

> 2026-06-22 分析报告。本文档记录对 macOS arm64 DMG 打包链路的完整检测结果、发现并修复的缺陷、体积分析、以及与主流 Electron 打包方案的对比评估。

## 一、当前打包架构

### 运行时拓扑

```
InkPress.app（Electron 壳）
  ├─ MacOS/InkPress              ← Electron 主进程（main.ts 编译产物）
  ├─ Frameworks/                 ← Electron 运行时（Chromium + Node.js）
  ├─ PlugIns/InkPressServer.app  ← LSUIElement helper（避免 Dock 双图标）
  └─ Resources/
       ├─ app.asar               ← 仅含 main.js（16KB）
       └─ standalone/            ← Next.js standalone 服务（1.2GB）
            ├─ server.js         ← Next.js 独立服务入口
            ├─ node_modules/     ← 运行时依赖（含 next/react/prisma/better-sqlite3 等）
            └─ .next/            ← Next.js 构建产物 + nft 追踪包
```

### 启动流程

```
main.ts bootstrap()
  → ensureDirs()                          创建 ~/.inkpress 目录结构
  → pickPort(17391)                       选择可用端口
  → startServer(port)                     spawn InkPressServer.app 子进程
      → ELECTRON_RUN_AS_NODE=1            以纯 Node 模式运行 Electron 二进制
      → node standalone/server.js         启动 Next.js standalone 服务
  → waitForServer(port, 30s)              TCP 轮询等待服务就绪
  → createWindow(port)                    BrowserWindow.loadURL("http://127.0.0.1:{port}")
```

本质：**Electron 只是一个壳，内核是跑在 localhost 上的 Next.js 全栈服务。** 前端页面和 API 路由全部由这个内嵌 Web 服务处理。

## 二、打包管线

### 构建命令链

```bash
pnpm electron:build
  → pnpm build                             Next.js 生产构建（Turbopack）
  → pnpm tsx scripts/prepare-standalone.ts standalone bundle 准备（7 个步骤）
  → pnpm electron:compile                  TypeScript → JavaScript（main.ts）
  → electron-builder --mac                 打包 DMG
```

### prepare-standalone.ts 的 7 个步骤

| 步骤 | 函数 | 作用 |
|---|---|---|
| 1 | `fs.cpSync` + `materializeSymlinks` | 复制 standalone 输出，物化 370 处 pnpm 符号链接 |
| 2 | `patchMissingPackages` | 从项目 node_modules 补全 nft 遗漏的子路径（如 `@swc/helpers/_/`） |
| 3 | `hoistMissingTopLevel` | BFS 遍历依赖树，从 `.pnpm/node_modules/` 虚拟根提升缺失包到顶层 |
| 4 | `rewriteServerJsPaths` | 将 server.js 中硬编码的构建机绝对路径改写为相对路径 |
| 5 | `copyInto` × 6 | 补充 static/public/prisma/skills/themes/migrations 资源 |
| 6 | `ensureNativeBindingForElectron` | electron-rebuild 重编译 better-sqlite3 为 Electron ABI，刷新全 bundle 副本 |
| 7 | `slimBundle` | 删除 .d.ts/.ts/.map/.md/LICENSE 等开发产物（减 ~200MB） |

### electron-builder 的 3 个步骤

| 步骤 | 配置 | 作用 |
|---|---|---|
| 1 | `@electron/rebuild` | 按目标架构重编译 better-sqlite3 |
| 2 | `afterPack` 钩子 | 创建 `PlugIns/InkPressServer.app` helper bundle（LSUIElement） |
| 3 | DMG 打包 | 生成 .dmg 安装镜像 |

## 三、本次检测发现并修复的缺陷

在 2026-06-22 的检测中，发现打包链路存在 5 个导致「打包后 app 无法启动」的缺陷。以下按发现顺序记录。

### 缺陷 1：better-sqlite3 原生绑定为 Linux ELF

- **现象**：`better_sqlite3.node` 文件为 `ELF 64-bit LSB shared object, ARM aarch64, version 1 (GNU/Linux)`
- **根因**：`node_modules` 曾被 Linux 环境（Docker/CI）污染，prebuilt 二进制下载了 Linux 版本
- **影响**：macOS 上完全无法加载 SQLite，所有数据库操作崩溃
- **修复**：`prepare-standalone.ts` 的 `electron-rebuild` 步骤重新编译为 Mach-O arm64

### 缺陷 2：native binding 刷新遗漏 `.next/node_modules/` 路径

- **现象**：`ensureNativeBindingForElectron()` 报告刷新 3 处，但运行时加载的 `.next/node_modules/better-sqlite3-HASH/` 仍为旧二进制
- **根因**：扫描范围仅 `bundle/node_modules/`，遗漏了 Next.js nft 追踪生成的 `.next/node_modules/better-sqlite3-a9b1042fd0ef418e/`（该路径是运行时模块解析的实际命中点）
- **影响**：Server Component 加载 better-sqlite3 时崩溃
- **修复**：扫描范围从 `path.join(bundle, "node_modules")` 改为整个 `bundle`，覆盖全部 4 处副本

### 缺陷 3：electron-builder 剥离 standalone bundle 顶层 `node_modules/`

- **现象**：打包后 `Resources/standalone/node_modules/` 目录消失，但源 bundle 中存在
- **根因**：electron-builder 对 `extraResources` 也应用了全局 `!**/node_modules/**` 排除规则。`filter: ["**/*"]` 无法覆盖该行为
- **影响**：server.js 无法 `require('next')`，服务进程启动即崩
- **修复**：`package.json` 的 `extraResources` 拆分为两条——单独一条 `from: ".next/standalone-bundle/node_modules"` 直接复制 node_modules 目录（绕过目录名过滤），另一条 `filter: ["**/*", "!node_modules/**"]` 复制其余内容

### 缺陷 4：`mergeDir` 跳过 pnpm 符号链接子目录

- **现象**：`patchMissingPackages` 报告补全 161 个包，但 `.pnpm/next@*/node_modules/@swc/helpers/_/` 仍为空
- **根因**：`fs.readdirSync({ withFileTypes: true })` 返回的 `Dirent.isDirectory()` 对 pnpm 符号链接目录返回 `false`（返回 `isSymbolicLink()`）。`mergeDir` 的 `if (e.isDirectory())` 分支跳过了所有符号链接子目录
- **影响**：`require('@swc/helpers/_/_interop_require_default')` 失败，next 模块链全线崩溃
- **修复**：`mergeDir` 中用 `fs.statSync(s)`（跟随符号链接）替代 `Dirent` 方法判断类型

### 缺陷 5：pnpm 虚拟存储兄弟解析路径在物化后断裂

- **现象**：`require('@swc/helpers')` 和 `require('@prisma/client-runtime-utils')` 均报 MODULE_NOT_FOUND
- **根因**：pnpm 靠 symlink 让 `next` 的真实路径在 `.pnpm/next@*/node_modules/next/` 内，其依赖 `@swc/helpers` 以兄弟目录 `.pnpm/next@*/node_modules/@swc/helpers/` 存在。`materializeSymlinks` 把顶层 symlink 物化为真实目录后，`next` 变成独立顶层目录，兄弟解析路径断裂，Node 只会从 `node_modules/@swc/helpers/` 查找，而该路径从未被创建
- **影响**：所有间接依赖（被顶层包 require 但自身不在顶层的包）无法解析
- **修复**：新增 `hoistMissingTopLevel()` 函数——
  1. 用项目 `.pnpm/node_modules/` 补全 bundle 虚拟根
  2. BFS 遍历顶层包和 `.next/node_modules/` nft 追踪包的 `dependencies`
  3. 从虚拟根提升缺失包到顶层 `node_modules/`

### 修复后验证结果

| 检查项 | 结果 |
|---|---|
| DMG 完整性（hdiutil verify） | VALID |
| 主二进制 / helper 二进制架构 | Mach-O arm64 |
| 4 处 better_sqlite3.node | 全部 Mach-O arm64 |
| 服务启动（port 17391 LISTEN） | 成功 |
| HTTP 首页 | 200 |
| API `/api/settings/status` | 正常返回 JSON |
| API `/api/themes` | 正常返回 4 个主题 |
| SQLite 数据库初始化 | 成功 |

## 四、体积分析

### DMG 内部体积分布

| 部分 | 大小 | 说明 |
|---|---|---|
| Frameworks/（Electron 运行时） | 273 MB | Chromium + Node.js，所有 Electron 应用不可避免 |
| Resources/standalone/node_modules/ | 1.1 GB | Next.js 服务运行时依赖 |
| Resources/standalone/ 其余 | ~50 MB | server.js + .next 构建产物 + 静态资源 |
| Resources/ 其余 | ~1 MB | app.asar + 主题 + migrations |
| **app 解压后总计** | **~1.5 GB** | |
| **DMG 压缩后** | **399 MB** | 最终安装包 |

### node_modules 前 8 大包

| 包 | 大小 | 运行时用途 | 能否删 |
|---|---|---|---|
| next | 17 MB | Next.js 服务端框架核心 | 不能 |
| @ts-morph | 12 MB | `src/lib/ai/project-index.ts` AI 代码索引 | 不能（AI 功能依赖） |
| jsdom | 9.3 MB | `src/lib/convert/to-wechat.ts` 微信发布 HTML 清洗 | 不能（发布功能依赖） |
| lodash | 5 MB | 多个包的间接依赖 | 不能 |
| caniuse-lite | 4.2 MB | Next.js CSS 兼容性数据 | 不能 |
| xml2js | 4.1 MB | ali-oss SDK 依赖 | 不能 |
| css-tree | 2.2 MB | Next.js CSS 处理 | 不能 |
| better-sqlite3 | 2.1 MB | 数据库引擎 | 不能 |

**结论**：体积大的包均有实际运行时用途，不存在可安全删除的"低挂果实"。`slimBundle` 已删除所有 .d.ts/.map/.ts/.md 等开发产物（减 ~200 MB）。

## 五、当前架构 vs 主流 Electron 方案

### 主流 Electron 架构（VS Code / Slack / Discord / Notion 采用）

```
应用代码 → webpack/vite 打包 → app.asar（单文件，5-20 MB）
     ↑                              ↑
  renderer 进程加载           main 进程加载
                                     ↑
                    IPC 通信 ← better-sqlite3 等原生模块（asarUnpack）
```

特点：前端打包成静态文件，后端逻辑走 Electron IPC（`ipcMain` / `ipcRenderer`），**不 ship node_modules**（除原生模块），总大小通常 150-170 MB。

### 本项目架构（Next.js standalone + Electron）

```
main.ts → spawn server.js（Next.js Node.js 服务进程，监听 17391 端口）
     ↓                                        ↑
  BrowserWindow.loadURL("http://127.0.0.1:17391")
                                             ↑
                                    需要 1.1 GB node_modules
```

特点：Electron 只是一个壳，内核是跑在 localhost 上的 Next.js 全栈服务。**需要 ship 完整 node_modules**（因为 Next.js 服务运行时需要 next/react/prisma 等全部依赖）。

### 两种架构的本质权衡

| 维度 | 本项目（standalone server） | 主流（bundled + IPC） |
|---|---|---|
| Web/桌面代码复用 | 100% 复用同一套 Next.js 代码 | API 层要重写为 IPC handler |
| 包体积 | 399 MB | ~150-170 MB |
| 启动速度 | 需等 Next.js 服务启动（TCP 轮询 30s 超时） | 秒开 |
| 内存占用 | Electron + Node server 双进程（+100-200 MB） | 单进程 |
| 架构复杂度 | 端口/进程管理/信号处理/nft 追踪补全 | 标准 Electron 模式 |
| 维护成本 | 一套代码（Web = 桌面） | Web 和桌面两套传输层 |

### 本项目选择非主流路线的原因

```
src/app/api/         ← 46 个 API 路由（文章/空间/素材/AI/微信...）
docker-compose.yml   ← 有 Docker 部署版本
next.config.ts       ← output: "standalone"
```

InkPress 同时是 Web 应用和桌面应用。用 standalone 方式打包桌面版，前端页面和 API 路由与 Web 版 100% 复用，Electron 只是套壳。这是刻意的架构选择，不是偶然。

## 六、迁移到主流方案的可行性评估

### 代码量统计

| 指标 | 数量 | 迁移影响 |
|---|---|---|
| API 路由（route.ts） | 46 个 | 每个要改成 IPC handler |
| Server Component 页面 | 10 个（全部） | 每个要改成 Client Component + IPC 取数 |
| 客户端 fetch('/api/') 调用 | 41 处 | 要改成 ipcRenderer.invoke |
| 'use client' 组件 | 48 个 | 不动 |
| Server Actions | 0 个 | 无影响 |
| AI 流式输出 | 1 处 | 需 IPC 流桥接 |
| 文件上传组件 | 5 个 | 需重写上传链路 |

### 技术栈变化评估

**不变的层（~70% 代码量）：**
- React 组件（48 个 'use client' 组件）— 原样保留
- 业务逻辑（`src/lib/`）— DB 查询、AI 调用、微信转换等全部保留
- Prisma + better-sqlite3 — 从 server 进程移到 main 进程，用法不变
- TipTap 编辑器 — 客户端组件，原样保留
- AI SDK（Vercel AI）— streamText / agent 逻辑保留，传输层变化

**要改的层（~20% 代码量）：**

1. **46 个 API 路由 → IPC handler**（机械翻译）

```typescript
// 现在：src/app/api/articles/route.ts
export async function GET(request: NextRequest) {
  const articles = await prisma.article.findMany({ ... });
  return NextResponse.json(articles);
}

// 改造后：electron/ipc/articles.ts
ipcMain.handle('articles:list', async (event, args) => {
  const articles = await prisma.article.findMany({ ... });
  return articles;
});
```

2. **10 个 Server Component 页面 → Client Component**

```tsx
// 现在：src/app/page.tsx（服务端直接查库）
export default async function HomePage() {
  const spaces = await prisma.space.findMany(...);
  return <HomeView spaces={spaces} />;
}

// 改造后：客户端 IPC 获取
'use client'
export default function HomePage() {
  const { data: spaces, loading } = useIPC('spaces:list');
  if (loading) return <Skeleton />;
  return <HomeView spaces={spaces} />;
}
```

3. **41 处 fetch → IPC 调用**（统一适配层）

**要特殊处理的层（~10%，有技术难度）：**

1. **AI 流式输出**：当前用 HTTP SSE（`createUIMessageStreamResponse`），改造后需手动桥接 ReadableStream → ipcRenderer 事件推送。Vercel AI SDK 官方无 IPC 适配方案。
2. **文件上传**：当前用 FormData multipart via fetch，改造后 Electron renderer 拿不到 File 对象的磁盘路径，需用 `webUtils.getPathForFile()` 或 `dialog.showOpenDialog()`。

### 迁移收益与风险

| 收益 | 风险 |
|---|---|
| 包体积 399 MB → ~160 MB | AI 流式输出的 IPC 桥接无成熟方案 |
| 启动速度：去掉 server 启动等待 | 10 个页面改 Client Component 需处理 loading/error 态 |
| 内存：去掉独立 Node server 进程 | Web 版和桌面版不再 100% 复用 |
| 构建管线大幅简化（删除 prepare-standalone / after-pack / hoist） | 文件上传链路需重写 |

### 迁移决策建议

| 场景 | 建议 |
|---|---|
| 只做桌面版（放弃 Docker/Web） | 迁移到主流方案最干净，收益最大 |
| 同时维护 Web + 桌面 | 保持当前架构，或抽共享 service 层 + 双传输层 |
| 追求最小包体积且接受重写 | 方案 D：换 Tauri（Rust + 系统 WebView，~10-20 MB） |

## 七、当前结论

维持当前 Next.js standalone + Electron 架构。理由：

1. **Web + 桌面代码复用是核心价值**：46 个 API 路由和 10 个页面与 Docker 版 100% 共享
2. **399 MB 对全栈写作工具可接受**：VS Code（~350 MB）、Slack（~400 MB）同量级
3. **打包链路已修复并验证通过**：5 个缺陷全部解决，arm64 DMG 功能完整
4. **迁移风险高于收益**：AI 流式 IPC 桥接、文件上传重写、双版本维护成本显著

后续如需瘦身，优先级：
1. 方案 B（esbuild 打包 server.js）— 中等改造，预期 node_modules 1.1 GB → ~200 MB
2. 方案 A（审计 hoist 包）— 低收益（10-20 MB），低风险
3. 方案 C（静态导出）/ 方案 D（Tauri）— 等同于重写，不推荐
