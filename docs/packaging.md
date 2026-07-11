# InkPress 桌面应用打包指南（macOS / Windows）

InkPress 桌面应用由 Next.js standalone server、Electron 壳和平台原生依赖组成。
打包必须在目标平台、目标 CPU 的原生 runner 上执行，不支持跨架构生成：

| 发布包 | 构建宿主 | 产物 |
|---|---|---|
| macOS Apple Silicon | macOS arm64 | `InkPress-<version>-arm64.dmg` |
| macOS Intel | macOS x64 | `InkPress-<version>-x64.dmg` |
| Windows | Windows x64 | `InkPress-<version>-x64.exe` |

macOS 最低版本为 13.0。应用本身和内置 Claude CLI 的最低系统版本必须同时满足该声明。

## 一、稳定打包入口

先执行 `pnpm install`，然后在对应的原生机器上运行：

```bash
# 自动使用当前机器架构
pnpm electron:build

# Apple Silicon Mac
pnpm electron:build:arm64

# Intel Mac 或 Windows x64
pnpm electron:build:x64
```

入口脚本会串行执行且任一步失败都会中止：

1. 校验宿主平台、CPU 架构和 Node 22。
2. TypeScript 检查与 Next.js production build。
3. 生成目标架构 standalone bundle，补全 pnpm/NFT 漏追踪依赖。
4. 在 bundle 副本内为 Electron ABI 重编 `better-sqlite3`。
5. 编译 Electron 主进程，生成单平台、单架构安装包。
6. 校验解包目录和安装介质。
7. 真正安装后运行原生依赖与 HTTP smoke test。

禁止在 Apple Silicon 上用 `--x64` 生成 Intel 包，或在 Intel 上用 `--arm64` 生成 M 系包。
bytenode 字节码、Electron V8 snapshot 和原生 `.node` 文件都与宿主架构绑定，跨架构产物可能能生成但无法启动。

## 二、完整性与瘦身策略

### standalone 处理

- 根目录只复制 `.next`、`node_modules`、`server.js`、`package.json`，避免 Next 动态 tracing 把本地数据库、`storage`、旧 `dist`、测试目录或凭据带进安装包。
- 所有 pnpm symlink/junction 都物化为真实文件，避免安装后仍指向构建机绝对路径。
- `server.js` 和 `.next/required-server-files.json` 中的构建机路径改写为相对路径。
- 从完整安装源 merge 依赖包，保证 React `react-server` 等条件导出不是 NFT 残片。
- `.next/static`、`public`、内置主题、系统 Skill 和 Prisma migrations 按源文件哈希复制并校验。
- 删除只用于构建的 `*.nft.json`、source map、声明、测试和文档；业务资源目录不应用这些删除规则。
- 只保留当前平台的 Claude CLI 与 Resvg 原生包。
- `server.js` 用当前 Electron 的 V8 编译为 `server.jsc`，并校验 SHA-256。

### 安装包策略

- Electron 语言仅保留英文和简体中文。
- macOS 使用 HFS+ / LZFSE（`ULFO`）DMG，兼顾体积、挂载和复制速度。
- Windows 使用 NSIS 普通压缩；项目没有自动更新器，因此不生成 differential blockmap，也不附带 elevate helper。
- 保持 `compression: normal`。`maximum` 会显著增加 CI 与安装解压时间，`store` 会明显放大下载体积。
- Claude CLI 是功能依赖，不做 UPX、strip 或二次改写，避免破坏其签名和 hardened runtime。

## 三、自动验证门禁

`pnpm electron:build*` 已自动覆盖以下检查：

- bundle 中入口、BUILD_ID、required-server metadata、字节码 hash 均有效。
- 资源源目录与安装包内 `.next/static`、public、themes、系统 Skill、migrations 文件清单和 SHA-256 完全一致。
- 所有 `.node`、Mach-O 或 PE 文件属于目标架构；Claude/Resvg 平台包版本与 wrapper 完全一致。
- macOS 只含 `en.lproj`、`zh_CN.lproj`，Windows 只含 `en-US.pak`、`zh-CN.pak`。
- DMG 可通过 `hdiutil verify`，实际格式为 ULFO，挂载后包含 App 和 Applications 链接。
- 配置完整签名凭据时，macOS 必须通过 `codesign`、Gatekeeper 与 stapler ticket 校验。
- macOS 将 App 从 DMG 复制到临时 Applications，卸载 DMG 后再启动。
- Windows 将 NSIS 静默安装到同时包含空格和中文的临时路径，从安装目录启动后再静默卸载。
- 打包后的 Electron Node 实际加载 React 条件导出、better-sqlite3、Resvg，并执行 `claude --version`。
- 全新数据目录实际执行所有 Prisma migrations，并访问 `/`、`/api/themes`、`/api/settings/status`、`/api/skills`。

## 四、签名、公证与发布

macOS 本地可从被 `.gitignore` 忽略的 `.env.apple` 读取 Apple 凭据。正式 CI 只有在证书、证书密码、Apple ID、app-specific password 和 Team ID 全部存在时才启用签名；凭据不完整会直接失败，不会发布“只签名未公证”的半成品。

三个 GitHub Actions workflow 分别在原生 arm64 Mac、x64 Mac 和 x64 Windows runner 上构建。Tag 发布先上传到同一个 draft Release；只有三个精确命名的安装包都存在时才解除 draft，避免某个平台失败后公开残缺 Release。

Windows 流水线支持可选 Authenticode 门禁；配置 `WIN_CSC_LINK` 与
`WIN_CSC_KEY_PASSWORD` 后会自动签名并强制校验安装器、主程序和卸载器。
未配置证书时功能与安装 smoke 仍会执行，但 SmartScreen/企业策略可能提示未知发布者。

## 五、常见问题

| 错误 | 原因 | 检查点 |
|---|---|---|
| `NODE_MODULE_VERSION ...` | better-sqlite3 不是 Electron ABI | `prepare-standalone` 的 rebuild 是否完成 |
| `cachedDataRejected` | bytenode 字节码与目标 Electron/架构不一致 | 必须在目标架构原生构建 |
| `Cannot find module '@swc/helpers/_/...'` | standalone 包内容不完整 | `patchMissingPackages()` 与 merge 完整性门禁 |
| `Cannot find module 'react.react-server.js'` | React 顶层包是 NFT 残片 | 条件导出 runtime probe 必须通过 |
| `Cannot find module '@prisma/client-runtime-utils'` | traced 包间接依赖缺失 | `.next/node_modules` 局部依赖闭包 |
| 安装后 server 引用构建机目录 | metadata 路径未改写 | `required-server-files.json` 与 server.js 路径门禁 |
| macOS Helper 架构混杂 | target 配置固定了错误架构 | `mac.target` 必须保持架构中性，由 CLI 决定 |

## 六、升级依赖检查清单

升级 Next.js、Electron、electron-builder、pnpm、better-sqlite3、Claude SDK 或 Resvg 后：

- [ ] 三个原生 workflow 均从干净依赖缓存完成构建。
- [ ] 三个安装介质 smoke test 均通过，而非只启动 unpacked 目录。
- [ ] macOS 两个包的全部 Mach-O 架构与最低系统版本通过。
- [ ] Windows 安装、启动、卸载及全部 PE x64 门禁通过。
- [ ] React 条件导出、SQLite、Resvg、Claude CLI、系统 Skill 和迁移门禁通过。
- [ ] draft Release 仅在三个精确资产全部存在后发布。

## 七、关键文件

| 文件 | 作用 |
|---|---|
| `scripts/electron-build.mjs` | 三平台统一打包入口和门禁编排 |
| `scripts/prepare-standalone.ts` | standalone 物化、补全、瘦身、原生 rebuild、字节码和完整性检查 |
| `scripts/server-externals.json` | Next tracing 与 prepare 共用的 server external 单一清单 |
| `scripts/verify-electron-package.mjs` | bundle、架构、资源、签名和安装介质校验 |
| `scripts/smoke-installed-package.mjs` | DMG/NSIS 真实安装 smoke test |
| `scripts/smoke-packaged-app.mjs` | 安装后原生依赖与应用启动 smoke test |
| `electron/main.ts` | Electron 主进程及打包态 HTTP smoke checks |
| `.github/workflows/release*.yml` | 三个目标平台的原生构建与 draft Release 协调 |
