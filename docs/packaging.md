# InkPress 桌面应用打包指南（macOS）

> 本文档记录了经过多次踩坑后沉淀的**稳定打包方案**。
> 打包链路脆弱的根因、每一处 hack 的作用、以及正确操作步骤，全部记录在案。
> **每次改 prepare-standalone.ts 或升级 Next.js / electron-builder 前，先读这份文档。**

## 一、为什么打包这么脆弱？（根因全景）

InkPress 桌面应用 = **Next.js standalone server**（跑在 Electron 内嵌 Node 里）+ **Electron 壳**。
三套工具链（Next.js / pnpm / electron-builder）各有自己的"默认行为"，我们的打包方案必须同时满足三者的约束，任何一处偏差都会让应用启动即崩。

### 脆弱链路的 6 个坑（按发现顺序）

| # | 坑 | 根因 | 当前解法 |
|---|---|---|---|
| 1 | **better-sqlite3 ABI 不匹配** | Electron 内嵌 Node ABI=146，标准 Node ABI=127，prebuilt 二进制不通用 | `@electron/rebuild` 针对目标 Electron 版本重编译 |
| 2 | **pnpm symlink 指向项目绝对路径** | `fs.cpSync(dereference:true)` 对 symlink **目录**仍重建 symlink 而非复制内容 | `materializeSymlinks()` 逐个物化为真实文件 |
| 3 | **server.js 硬编码构建机绝对路径** | Next.js 把 `outputFileTracingRoot`/`turbopack.root` 写死成构建目录 | `rewriteServerJsPaths()` 替换为 `.` |
| 4 | **standalone file tracing 漏追踪子路径** | `@swc/helpers/_`、`esm/` 等子目录没被 Next.js 静态分析追踪到 | `patchMissingPackages()` 从项目 node_modules 补全 |
| 5 | **打包污染开发环境** | `electron-builder` 的 after-pack 阶段会 rebuild x64，覆盖开发用的 arm64 二进制 | 打包后**必须** `pnpm rebuild better-sqlite3` 恢复 |
| 6 | **node_modules 改名 app_modules** | 之前误以为 electron-builder 的 files 规则会剔除 extraResources 里的 node_modules（实际不会） | **保留 node_modules 原名**，靠 NODE_PATH 已无必要 |

### "之前能跑"是假象

旧版本能启动，是因为路径改写（坑 3）没做，server 子进程加载的是**开发目录**的 better-sqlite3，恰好那时 ABI 兼容（都是标准 Node 编译的）。一旦开发环境被 x64 rebuild 污染（坑 5），假象就破了。

## 二、正确的打包流程

### 前置条件
- macOS（arm64 Apple Silicon 或 Intel x64）
- 已 `pnpm install`
- `~/.inkpress` 数据目录（首次会自动创建）

### 打包命令（仅当前架构，推荐）

```bash
# 方式 A：只打当前机器架构（快，不污染开发环境的另一架构二进制）
pnpm electron:build -- --arm64    # Apple Silicon
pnpm electron:build -- --x64      # Intel

# 方式 B：双架构（慢，会触发坑 5 的污染）
pnpm electron:build
```

### ⚠️ 打包后必做（恢复开发环境）

```bash
pnpm rebuild better-sqlite3
```

electron-builder 的 after-pack 会针对打包目标架构重编译 better-sqlite3，**覆盖开发环境用的本机架构二进制**。不执行这步，`pnpm dev` 会崩（`mach-o file, but is an incompatible architecture`）。

### 验证打包结果

```bash
# 1. DMG 存在
ls -lh dist/InkPress-0.1.0-arm64.dmg

# 2. 挂载验证应用架构
hdiutil attach dist/InkPress-0.1.0-arm64.dmg -nobrowse
file "/Volumes/InkPress 0.1.0-arm64/InkPress.app/Contents/MacOS/InkPress"
# 应输出: Mach-O 64-bit executable arm64
hdiutil detach "/Volumes/InkPress 0.1.0-arm64"

# 3. 安装并启动
cp -R "/Volumes/InkPress 0.1.0-arm64/InkPress.app" /Applications/
open /Applications/InkPress.app

# 4. 查日志（应无 error）
tail ~/.inkpress/logs/inkpress.log

# 5. 前台启动看 server 子进程输出（排查用）
"/Applications/InkPress.app/Contents/MacOS/InkPress" 2>&1 | head
```

## 三、首次启动被 Gatekeeper 拦截

应用未签名（无 Apple 开发者证书），首次打开会被拦截。
- 右键 InkPress.app → 打开 → 仍要打开
- 或：系统设置 → 隐私与安全性 → 「仍要打开」

## 四、调试打包问题

### server 子进程崩溃排查
打包应用的 server 崩溃通常不写日志（崩在日志初始化前）。前台跑 Electron 主进程看实时输出：

```bash
"/Applications/InkPress.app/Contents/MacOS/InkPress" 2>&1 | tee /tmp/inkpress.log
# 关注 [next] 开头的行（server 子进程 stdout/stderr）
```

### 常见错误对照

| 错误信息 | 原因 | 修复 |
|---|---|---|
| `NODE_MODULE_VERSION 127 ... need 146` | better-sqlite3 用标准 Node 编译，Electron 要 ABI 146 | `ensureNativeBindingForElectron()` 未跑成功，检查 electron-rebuild |
| `mach-o ... incompatible architecture (have 'x86_64', need 'arm64')` | 打包后没恢复开发环境 | `pnpm rebuild better-sqlite3` |
| `Cannot find module '@swc/helpers/_/...'` | standalone file tracing 漏追踪 | `patchMissingPackages()` 补全 |
| server.js 报项目绝对路径 | outputFileTracingRoot 没改写 | `rewriteServerJsPaths()` 未跑 |

## 五、升级依赖时的检查清单

升级 Next.js / electron-builder / better-sqlite3 / pnpm 后，打包链路可能需要调整：

- [ ] `pnpm electron:build -- --arm64` 能否生成 DMG
- [ ] 安装后应用能启动（无 server error）
- [ ] 数据库初始化日志正常（`~/.inkpress/logs/inkpress.log` 无 error）
- [ ] `pnpm rebuild better-sqlite3` 后 `pnpm dev` 正常
- [ ] 配置页、文章编辑、素材上传、公众号推送四条核心链路可用

## 六、关键文件索引

| 文件 | 作用 |
|---|---|
| `scripts/prepare-standalone.ts` | 打包前处理 standalone bundle（物化/补全/改写路径/重编译 native） |
| `electron/main.ts` | Electron 主进程，spawn standalone server 子进程 |
| `scripts/after-pack.cjs` | electron-builder after-pack 钩子 |
| `next.config.ts` | `output: "standalone"` + `serverExternalPackages` |
| `package.json` → `build` | electron-builder 配置（extraResources 指向 bundle） |
