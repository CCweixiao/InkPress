# 多渠道一键发布 Driver 设计

> **状态**：设计稿（RFC），待后续版本迭代实施
> **日期**：2026-07-03
> **关联**：
> - 主题多渠道适配（已实施）：`src/lib/publish/channels/`、`src/lib/convert/{render-inline,to-wechat}.ts`
> - 微信发布（driver 范本）：`src/lib/wechat/*`、`src/app/api/wechat/draft/route.ts`
> - 规划溯源：`.claude/plans/atomic-orbiting-sifakis.md`

---

## TL;DR

为知乎/掘金/博客园等"无官方开放写入 API"的平台，做**真·一键发布（草稿）**。路线=**自研 PublishDriver**（不复用 Wechatsync，因 GPL-3.0）；首发=**博客园（MetaWeblog）+ 掘金（cookie-push）**，各覆盖一种技术模式。

driver **落地在 Next.js server 侧**（非 Electron 主进程），完全沿用 `src/lib/wechat/*` 范式。MVP 登录态用"设置页手填凭证"（同微信 config），可视化 BrowserView 登录列为后续增强。

---

## 1. 背景

InkPress 已支持：
- 微信公众号 API 直发（`src/lib/wechat/` + `/api/wechat/draft`）
- 多渠道"导出可粘贴 HTML"（channel `kind: export-html`，已实施）

下一步：把"复制 HTML → 手动粘贴"升级为"一键发草稿"，先覆盖技术社区（掘金/博客园，后续扩知乎/CSDN）。

## 2. 平台现实与业界调研

知乎、掘金、CSDN **均无公开的第三方写入 API**。业界所有"一键发布"工具统一走：**复用用户浏览器登录态（cookie）→ 调平台 Web 编辑器自用的官方内部 API**（与手动发布等价）。

- **Wechatsync**（[GitHub](https://github.com/wechatsync/Wechatsync)，GPL-3.0，29+ 平台）：Chrome 扩展形态，`packages/core` 用适配器模式 + Runtime 抽象层。合规立场值得借鉴——不模拟登录、不传密码、不经第三方服务器、草稿优先。
- **doocs/md**、TurboPush、obsidian-enhanced-publisher：同思路。
- **博客园是例外**：有官方标准的 **MetaWeblog API**（XML-RPC），稳定、合规、零封号风险。

**License 约束**：Wechatsync 为 GPL-3.0，**不可复用其代码**（会传染 InkPress），仅借鉴 API 调用思路（API 事实不受版权保护）。因此选自研。

## 3. 关键决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 路线 | 自研 driver | GPL 不可复用；自研可控、与现有架构融合 |
| 首发平台 | 博客园 + 掘金 | 各覆盖一种模式（MetaWeblog / cookie-push），验证最充分 |
| **driver 落地位置** | **Next.js server 侧**（`src/lib/publish/drivers/` + `/api/publish/*`） | 主进程是哑管道，见 §4 |
| 登录态采集（MVP） | 设置页手填 cookie/令牌 | 主进程无 BrowserView/session 先例；与 `inkpress.wechat` 同构 |
| 默认形态 | 草稿优先 | 合规 + 防风控 |
| 降级策略 | 未登录/失败 → export-html | 渠道卡片始终可用 |

### 3.1 ⚠️ 方案修正：driver 在 server 侧，不在主进程

原设想是"Electron 主进程 driver + IPC + BrowserView 可视化登录"。经探索发现 InkPress 主进程是纯生命周期管理器（见 §4），**driver 必须放 server 侧**，沿用 `src/lib/wechat/*` 范式。这是与最初设想的最大偏差，特此记录，避免后续实施时混淆。

## 4. 架构约束（主进程探索结论）

`electron/main.ts` 是自包含的纯生命周期管理器：
- 只做三件事：建 `~/.inkpress` 目录 → `spawn` Next.js standalone server 子进程 → 创建 `BrowserWindow` 指向 `http://127.0.0.1:<port>`
- **全仓零 IPC**（`ipcMain`/`contextBridge`/`preload` grep 命中 0）
- **主进程不能 import `@/lib`**（`tsconfig.electron.json` 仅 include `electron/**/*.ts`，不配 `paths`；`main.ts:9-10` 注释明说"自包含"）
- **零 `BrowserView`/`session.fromPartition`/`webContents` 操作先例**
- 所有业务逻辑在 Next.js server 子进程；renderer 通过 HTTP `/api/*` 通信（不经过主进程）
- 凭证存 `SystemConfig` 表 + 字段级加密（`src/lib/config-secrets.ts`）

**推论**：driver 与微信发布同构——server 侧调外部 API、凭证存 SystemConfig、原生 fetch、复用 storage 转存。唯一新挑战是"第三方登录态采集"（§5.4）。

## 5. 架构设计

### 5.1 整体架构

```
Renderer (PublishEntryDialog 渠道卡片)
    │  fetch /api/publish/*
    ▼
Next.js server  (src/app/api/publish/route.ts)
    │
    ▼
PublishDriver 注册表  (src/lib/publish/drivers/index.ts)
    │   getDriver(id).publish(req)
    ├── cnblogs driver   (MetaWeblog XML-RPC)
    ├── juejin driver    (cookie REST)
    └── (后续) zhihu / csdn / segmentfault ...
    │
    │  凭证：SystemConfig "inkpress.publish.<platform>"（字段级加密）
    │  图片转存：复用 src/lib/storage + wechat/material 模式
    │  HTML：复用已实施的 channel.finalize（renderInlineHtml 产物）
    ▼
各平台 API
```

### 5.2 PublishDriver 接口

```ts
// src/lib/publish/drivers/types.ts
export interface PublishDriver {
  id: "cnblogs" | "juejin" | "zhihu" | ...;
  authType: "credential" | "cookie";
  /** 凭证/cookie 是否有效（UI 登录态指示灯常调） */
  checkAuth(): Promise<boolean>;
  /** 发草稿；图片转存失败不阻塞，收集后回显 */
  publish(req: PublishRequest): Promise<PublishResult>;
  /** 转存正文图到目标平台图床，返回平台内链 URL */
  uploadImage?(blob: Buffer, ext: string): Promise<string>;
}

export interface PublishRequest {
  articleId: string;
  title: string;
  html: string;          // 已 channel.finalize 的全内联 HTML（复用现有管道）
  markdown?: string;     // 博客园等可选 md
  coverUrl?: string;
  tags?: string[];
}

export interface PublishResult {
  remoteId: string;
  draftUrl: string;      // 供用户核对
  publishedUrl?: string;
}
```

```ts
// src/lib/publish/drivers/index.ts
const DRIVERS: Record<string, PublishDriver> = {
  cnblogs: cnblogsDriver,
  juejin: juejinDriver,
};
export function getDriver(id: string): PublishDriver | undefined;
export function allDriverStatuses(): Promise<DriverStatus[]>; // 供 UI 渲染登录态
```

### 5.3 与现有 channel 注册表融合

`ChannelMeta`（`src/lib/publish/channels/meta.ts`）扩展：
- `kind` 加第三值：`"api-push"`（微信）/ `"browser-push"`（掘金、博客园）/ `"export-html"`（降级）
- 新增 `driverId?: string`（指向 PublishDriver）
- 客户端只读元数据（`driverId` 是否存在 + 调 `/api/publish/status` 拿登录态），**不引 driver 实例**（守 [[client-bundle-no-node-deps]]）

渠道的 HTML 后处理（`channel.finalize`）已实施，driver 直接复用其产出的全内联 HTML 发布——**主题美化层零改动**。

### 5.4 凭证与登录态存储

- 新 SystemConfig key：`inkpress.publish.<platform>`（如 `inkpress.publish.cnblogs`、`inkpress.publish.juejin`）
- 在 `src/lib/config-secrets.ts` 的 `CONFIG_SECRET_FIELDS` 注册 secret 字段路径（掘金 cookie 整体加密；博客园 token 加密）
- 读取范本：`src/lib/wechat/config.ts:28-36`（`getWechatConfig` 模式）

**MVP 登录态采集**（手填，与微信 config 同构）：
| 平台 | 用户填什么 | 从哪来 |
|---|---|---|
| 博客园 | 用户名 + MetaWeblog 访问令牌 | 博客园后台 → 设置 → "MetaWeblog 访问令牌" |
| 掘金 | cookie 字符串（sessionid 等） | 浏览器 DevTools → Network → 复制请求 cookie |

（可视化登录免手填见 §9 后续增强）

### 5.5 图片转存（保证发布后不裂图）

抽通用"正文图批量转存"工具，复用 `src/lib/wechat/material.ts:24` 的 `uploadBodyImage(sourceUrl, fetcher)` 模式（并发 3 + 失败收集 + 失败图保留外链）：
- 图片下载：`fetch + arrayBuffer + AbortSignal.timeout`（范本 `wechat/asset-sync.ts:40-50`）
- 每个 driver 注入自己的 `uploadImage`（转存到目标平台图床）
- SVG→PNG 兜底：`wechat/svg-to-png.ts:177`（部分平台不支持 SVG）

### 5.6 错误处理 + 草稿优先

- 一律发草稿、返回 `draftUrl`；UI 显示"打开草稿"按钮，用户核对后手动发布
- 失败图保留原外链 + 列表提示（沿用微信 `failedImages` 模式）
- 认证失效：driver 抛特定错误码 → UI 引导重填凭证

## 6. MVP 平台技术细节

### 6.1 博客园（MetaWeblog，先做，验骨架）

| 项 | 说明 |
|---|---|
| 协议 | XML-RPC（官方标准） |
| endpoint | `https://rpc.cnblogs.com/metaweblog/{username}`（**待官方文档确认**） |
| 方法 | `blogger.getUsersBlogs`（验凭证）/ `metaWeblog.newPost`（发文）/ `metaWeblog.newMediaObject`（传图） |
| 认证 | 用户名 + 访问令牌（博客园后台申请） |
| 技术点 | XML-RPC 客户端选型（手写 XML vs `xmlrpc` 库，需评估打包体积） |
| 优势 | 零封号、协议稳定、合规——**首选验证 driver 框架 + 凭证存储 + 图片转存骨架** |

### 6.2 掘金（cookie-push，验第二条路）

| 项 | 说明 |
|---|---|
| 协议 | REST + JSON |
| endpoint | Web 编辑器自用接口（**待抓包确认**，约 `/content_api/v1/article/...`） |
| 认证 | cookie（`sessionid` 等，用户从浏览器复制） |
| 请求体 | `title` / `content`(HTML) / `cover_image` / `category` / `tags` |
| 技术点 | cookie 携带、图片转存掘金图床、API 变更跟进 |
| 风险 | API 会变（需持续维护）、风控（坚持草稿优先） |

## 7. 落地阶段

1. **driver 框架**：`PublishDriver` 接口 + 注册表 + `/api/publish/{status,publish}` 路由骨架 + channel 注册表加 `browser-push`/`driverId`
2. **博客园 driver**：MetaWeblog，验证骨架 + 凭证存储 + 图片转存（最稳，先跑通端到端）
3. **掘金 driver**：cookie-push + 图片转存掘金图床（验证第二条技术路线）
4. **通用图片转存工具抽取**：从微信 `material.ts` 抽公共并发/失败处理，各 driver 接入
5. **UI**：设置页加"发布渠道"凭证表单（沿用 settings-nav 的 `publish` group）+ 渠道卡片登录态指示 + 发布后草稿链接回显

每阶段独立可验证。

## 8. 风险与限制

- **平台 API 漂移**：掘金尤甚。限定支持平台数（不做 29 个），靠 checkAuth + 错误码快速发现
- **登录态有效期**：cookie/token 会过期，`checkAuth` 常调，过期提示重填
- **封号风险**：虽走官方 Web API（与手动等价），但高频/异常仍可能触发风控。坚持草稿优先 + 人工确认，不静默直发
- **cookie 手填体验差**：MVP 妥协，§9 BrowserView 增强解决
- **HTML 平台过滤**：部分平台会剥 `<section>`/`data-*`/某些 inline style。实施时需对各平台真机测试（通用渠道 HTML 已避免微信式 section 化，风险低）

## 9. 后续迭代候选

- **BrowserView 可视化登录**（免手填 cookie）：需主进程新能力——IPC + preload + contextBridge + `session.fromPartition`。这是仓库内 0 先例路径，成本最高但体验最好，对齐 Wechatsync
- **更多平台**：知乎/CSDN/SegmentFault/开源中国（复制掘金 driver 模式）
- **AI 集成**：参考 Wechatsync 的 MCP 模式，让 AI agent 调用发布能力
- **发布历史**：新增 `ArticlePublish` 表（按渠道存 `remoteId`/`draftUrl`/`status`/`publishedAt`），支持"已发布"状态回写与重发

## 10. 待研究项（实施时确认）

- [ ] 博客园 MetaWeblog endpoint 与访问令牌申请流程（查官方文档）
- [ ] 掘金发布 API 精确 endpoint 与请求体（抓包 Web 编辑器）
- [ ] 掘金图片上传接口与图床规则
- [ ] XML-RPC 客户端选型（手写 vs 库，评估打包体积与 Electron 兼容）
- [ ] 各平台对 HTML 的过滤规则（`section`/`data-*`/伪元素是否被剥）

## 11. 附录

### 11.1 现成可复用清单

| 能力 | 位置 | driver 用途 |
|---|---|---|
| 凭证存储 + 字段级加密 | `SystemConfig` 表 + `src/lib/config-secrets.ts` | 存 driver 凭证 |
| 凭证读取范本 | `src/lib/wechat/config.ts:28-36` | `getDriverConfig` |
| token 缓存（单实例 + 防 stampede） | `src/lib/wechat/token.ts:15-63` | driver token 管理 |
| 图片下载 | `src/lib/wechat/asset-sync.ts:40-50` | 转存前置下载 |
| 图片上传（并发 + 失败收集） | `src/lib/wechat/material.ts:24` `uploadBodyImage` | 通用图片转存 |
| 存储抽象（OSS/本地） | `src/lib/storage/index.ts:105-137` | 资源落盘 |
| SVG→PNG 兜底 | `src/lib/wechat/svg-to-png.ts:177` | 平台兼容 |
| HTTP 客户端 | 原生 `fetch`（全仓无 axios） | 调平台 API |
| logger | `moduleLogger("publish.<platform>")` | 日志 |
| 路径 | `@/lib/paths`（不硬编码 `~/.inkpress`） | 数据目录 |

### 11.2 关键 file:line

- 主进程入口与约束：`electron/main.ts:1-7, 9-10, 106-121, 325-343`、`tsconfig.electron.json`
- SystemConfig 表：`prisma/schema.prisma:421-427`
- 凭证加密白名单：`src/lib/config-secrets.ts:5-19`
- 微信发布全链路（driver 范本）：`src/lib/wechat/{config,token,material,asset-sync,draft,client}.ts`、`src/app/api/wechat/draft/route.ts`
- 已实施的多渠道主题管道：`src/lib/publish/channels/{meta,finalize}.ts`、`src/lib/convert/{render-inline,to-wechat}.ts`

### 11.3 参考资料

- [Wechatsync/Wechatsync](https://github.com/wechatsync/Wechatsync) — packages/core 适配器 + Runtime 抽象、29+ 平台、工作原理
- [Wechatsync 技术架构解析](https://zhuanlan.zhihu.com/p/1999178798168577929) — 适配器模式与平台差异封装
- [自动发布文章到 5 个平台（掘金）](https://juejin.cn/post/7629183326780276763) — 各平台认证方式
- 博客园 MetaWeblog API 官方文档（实施时查）
