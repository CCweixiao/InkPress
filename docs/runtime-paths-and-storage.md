# InkPress 运行时路径、DB 与文件存储体系

> 适用范围：开发环境（`pnpm dev`）与 macOS DMG 桌面部署。Docker 服务端部署同构，文末附带对照。
> 代码事实来源：`src/lib/paths.ts`（路径解析）、`electron/main.ts`（桌面主进程）、`src/lib/init.ts`（首次启动初始化）、`src/lib/ai/claude-agent-options.ts`（Claude Agent SDK 接入）。

## 一、总体设计

InkPress 桌面应用 = **Next.js standalone server**（跑在 Electron 内嵌 Node 里）+ **Electron 壳**。运行时数据严格区分两类目录：

| 类别 | 含义 | 写入时机 | 升级是否覆盖 |
|---|---|---|---|
| **用户数据根 `dataHome`** | DB、文章正文、缓存、用户 skill、日志、Claude SDK 工作区 | 运行时持续写入 | ❌ 永不覆盖（用户资产） |
| **只读资源根 `resourceRoot`** | standalone server、内置主题 CSS、系统 skill、Prisma 迁移脚本 | 打包时固化进 `.app` bundle | ✅ 整包替换即更新 |

判定形态的唯一开关是环境变量 **`INKPRESS_HOME`**：

- **开发模式**：未设 `INKPRESS_HOME` → `dataHome()` 返回 `null`，所有用户数据回落到**项目工作区**（`process.cwd()`），保持 `pnpm dev` 行为不变。
- **打包模式**（DMG / Docker）：设了 `INKPRESS_HOME` → `dataHome()` 返回该值；桌面默认 `~/.inkpress`，Docker 默认 `/data`。

只读资源根优先级：`RESOURCE_ROOT` > `INKPRESS_RESOURCES_DIR`（别名）> `process.cwd()`。桌面形态下由 Electron 主进程注入（指向 `Contents/Resources/`），不依赖 `process.resourcesPath`（server 子进程下会误指向 `Electron.app`）。

> ⚠️ 一个关键不对称：Claude Agent SDK 的工作目录用 `inkpressHomeDir()` 而非 `dataHome()`，**开发模式下也落在 `~/.inkpress`**，目的是让它与项目工作区、用户本地 Claude Code 三方彻底隔离（见第六节）。

## 二、路径解析函数对照（`src/lib/paths.ts`）

| 函数 | 开发模式（无 `INKPRESS_HOME`） | 打包模式（`INKPRESS_HOME` 已设） |
|---|---|---|
| `inkpressHomeDir()` | `~/.inkpress` | `$INKPRESS_HOME`（桌面默认 `~/.inkpress`） |
| `dataHome()` | `null`（回落项目根） | `$INKPRESS_HOME` |
| `resourceRoot()` | `process.cwd()` | `$RESOURCE_ROOT`（= `Contents/Resources/`） |
| `dbPath()` | `<项目>/dev.db` | `<home>/database/inkpress.db` |
| `databaseUrl()` | `file:<项目>/dev.db` | `file:<home>/database/inkpress.db` |
| `databaseDir()` | `<项目>/dev.database` | `<home>/database` |
| `backupDir()` | `<项目>/dev.database/backups` | `<home>/database/backups` |
| `migrationScriptsDir()` | `<项目>/dev.database/scripts` | `<home>/database/scripts` |
| `storageDir()` | `<项目>/storage` | `<home>/storage` |
| `cacheDir()` | `<项目>/storage/tmp` | `<home>/cache` |
| `claudeAgentRuntimeDir()` | **`~/.inkpress/cache/claude-agent`** | **`<home>/cache/claude-agent`** |
| `logsDir()` | `<项目>/logs` | `<home>/logs` |
| `userSkillsDir()` | `<项目>/resources/skills/user` | `<home>/resources/skills/user` |
| `systemSkillsDir()` | `<cwd>/resources/skills/system` | `<resourceRoot>/resources/skills/system` |
| `themesDir()` | `<cwd>/themes` | `<resourceRoot>/themes` |
| `migrationsDir()` | `<cwd>/prisma/migrations` | `<resourceRoot>/migrations` |
| `markerFile()` | `<项目>/.update` | `<home>/.update` |

覆盖入口（测试 / 自定义部署用）：`CONTENT_DIR` 覆盖 `storageDir()`；`INKPRESS_HOME` 覆盖用户数据根；`RESOURCE_ROOT` 覆盖资源根。

## 三、数据库体系

**选型**：SQLite（`better-sqlite3` 原生绑定）+ Prisma ORM。零运维，单文件，未来可平滑迁移 Postgres。`provider = "sqlite"`，schema 见 `prisma/schema.prisma`。

**DB 文件位置**

| 环境 | DB 文件 | DATABASE_URL 来源 |
|---|---|---|
| 开发 | `<项目>/dev.db` | `databaseUrl()`（Prisma 适配器消费） |
| DMG | `~/.inkpress/database/inkpress.db` | Electron 主进程注入 `env.DATABASE_URL` 给 server 子进程 |
| Docker | `/data/database/inkpress.db` | `ENV INKPRESS_HOME=/data` 推导 |

**迁移机制（双轨）**

- **开发**：`prisma migrate dev`（`pnpm db:migrate`）。迁移源在 `prisma/migrations/`，执行后 InkPress 自定义 runner 另把脚本副本留档到 `dev.database/scripts/<ts>/` 并写 `.success` 审计标识。
- **打包**：server 进程启动时 `instrumentation.ts → ensureDataHome() → runMigrations(dbPath(), migrationsDir())`。迁移源从**只读资源根**的 `migrations/` 读取（`prepare-standalone` 把 `prisma/migrations` 拷进 standalone bundle）。每次启动幂等补齐未执行版本，跨版本升级自动兼容旧库 `_prisma_migrations`。

**备份**：迁移前自动备份到 `backupDir()`，滚动保留 5 份，命名 `inkpress.db.bak.<YYYY-MM-DD_HH-mm-ss-SSS>`。

> 主进程（Electron）**不直接**加载 better-sqlite3——规避 Electron Node ABI 与标准 Node ABI 不匹配。建表 + seed 在 server 子进程（`ELECTRON_RUN_AS_NODE=1`，标准 Node ABI）里由 `instrumentation.ts` 完成。这是打包链路最脆弱的一环，详见 `docs/packaging.md`。

## 四、文件存储体系

文章正文等大文本已从 DB 列迁出至文件（`Article.contentPath` 存相对路径，正文读文件），DB 只留元数据。统一存储层（`StorageObject` 模型）描述文件实际位置与完整性，`provider` 可为 `local | aliyun-oss | s3 | r2 | cos | qiniu | minio`。

`storageDir()` 下的子目录（`init.ts` 首次启动幂等创建）：

| 子目录 | 内容 |
|---|---|
| `articles/` | 文章正文 `<id>.md` |
| `spaces/<spaceId>/articles/` | 按空间隔离的文章（多视图归属） |
| `library/` | 统一存储素材（图片 / 视频 / 音频 / 文件），`local` provider 时文件落此 |
| `code-sources/<sourceKey>/snapshots/` | 代码源快照（供技术文档 / agent 引用） |
| `technical-documents/` | 技术文档正文 |

缓存与日志独立于 `storageDir()`：

| 用途 | 开发 | 打包 |
|---|---|---|
| 临时文件 / 分片上传临时 | `<项目>/storage/tmp`（`cacheDir()`） | `~/.inkpress/cache` |
| 日志 | `<项目>/logs/inkpress.log` | `~/.inkpress/logs/inkpress.log` |

日志：pino，JSON 行，单文件 20MB、保留 5 份滚动；开发模式额外 pino-pretty 美化控制台。

> 说明：开发模式下磁盘上看到的 `<项目>/storage/tmp/claude/` 是**旧版本遗留产物**（重构前的 Claude 数据位置）。当前代码已把 Claude Agent SDK 数据迁到 `claudeAgentRuntimeDir()`（`~/.inkpress/cache/claude-agent`），不再写入 `storage/tmp/claude`，可安全清理。

## 五、Claude Agent SDK 工作目录

SDK 接入集中在 `src/lib/ai/claude-agent-options.ts` 的 `buildClaudeAgentOptions()`。运行时目录由 `claudeAgentRuntimeDir()` 统一收口：

```
<inkpressHome>/cache/claude-agent/
├── config/      ← CLAUDE_CONFIG_DIR：SDK 本地配置 / transcript 写入处
└── workspace/   ← cwd：SDK 工作目录（避免绑定到 InkPress 仓库或用户 Claude Code 目录）
```

注入方式（`options.env` + `options`）：

| 项 | 值 | 作用 |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | `<runtimeDir>/config` | **重定向 SDK 配置/会话目录**，使其不读写用户 `~/.claude` |
| `cwd` | `<runtimeDir>/workspace` | 固定工作目录，避免 SDK 默认绑定 InkPress 开发仓库或用户本地工作区 |
| `settingSources` | `[]` | 进入 SDK **隔离模式**，不读用户级 / 全局级 / 项目级 settings |
| `persistSession` | `true` | 开启 SDK 会话持久化 |
| `sessionStore` | `createPrismaSessionStore()` | **自定义 Prisma/SQLite SessionStore**，transcript 镜像到 `ClaudeAgentSessionEntry` 表 |
| `env.ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` | 从 DB `SystemConfig` 的 `inkpress.llm` 读后注入 | 后端供应商动态切换，不依赖用户 shell 环境 |
| `env.ANTHROPIC_API_KEY` | `undefined` | 显式清空，避免与 `ANTHROPIC_AUTH_TOKEN` 冲突 |

`config/` 与 `workspace/` 在 `init.ts`（打包形态）与 `buildClaudeAgentOptions()`（每次 query 前）两处幂等 `mkdir -p`。

会话恢复：`resume: <claudeAgentSessionId>` 让 SDK 跨轮 / 跨刷新记忆。transcript 主存于 `inkpress.db` 的 `ClaudeAgentSessionEntry`（按 `appendSeq` 保序、uuid 幂等），SDK resume 时由 Prisma SessionStore 物化为临时 JSONL 喂给子进程。

## 六、与本地 Claude Code 的隔离

本机已安装 Claude Code（`~/.claude/`）。InkPress 内嵌的 Claude Agent SDK 必须与之**配置与数据完全隔离**，避免互相污染会话历史、settings、凭证。隔离由三道闸门保证：

| 闸门 | InkPress SDK 写入处 | 本地 Claude Code 写入处 |
|---|---|---|
| `CLAUDE_CONFIG_DIR` 重定向 | `~/.inkpress/cache/claude-agent/config/` | `~/.claude/`（settings.json、projects/、sessions/、history.jsonl …） |
| `cwd` 固定 | `~/.inkpress/cache/claude-agent/workspace/` | 用户启动 `claude` 时的当前工作目录 |
| `settingSources: []` | 不读任何外部 settings | 读取 `~/.claude/settings.json` 等 |
| SessionStore 自定义 | transcript → `inkpress.db` `ClaudeAgentSessionEntry` | transcript → `~/.claude/projects/...jsonl` |
| API 凭证 | DB `SystemConfig.inkpress.llm` → `ANTHROPIC_AUTH_TOKEN` | 用户 shell / `~/.claude` 配置 |

结论：两者唯一共享的是「同一次 API 调用走同一台机器的网络」，**文件系统层面零交集**。用户卸载 / 升级 InkPress 不影响本地 Claude Code；反之亦然。

## 七、开发环境完整清单（`pnpm dev`）

软件工作目录 = 项目根 `/Users/jielongping/OpenProject/InkPress`，外加隔离的 `~/.inkpress`（仅 Claude SDK 用）。

| 类别 | 路径 | 说明 |
|---|---|---|
| 软件 / 代码工作目录 | `<项目>/` | 源码、node_modules、构建产物 |
| DB 文件 | `<项目>/dev.db` | SQLite 单文件（`.gitignore` 已忽略） |
| DB 目录（备份 + 迁移留档） | `<项目>/dev.database/` | `backups/`、`scripts/<ts>/` |
| 迁移源 | `<项目>/prisma/migrations/` | `prisma migrate dev` 消费 |
| 文章 / 素材 / 代码源存储 | `<项目>/storage/` | `articles/ spaces/ code-sources/ tmp/` |
| 临时缓存 | `<项目>/storage/tmp/` | 分片上传临时等 |
| 用户 skill | `<项目>/resources/skills/user/` | |
| 系统 skill（只读） | `<项目>/resources/skills/system/` | |
| 内置主题（只读） | `<项目>/themes/` | |
| 日志 | `<项目>/logs/inkpress.log` | |
| **Claude Agent SDK 工作区** | **`~/.inkpress/cache/claude-agent/`** | `config/`（CLAUDE_CONFIG_DIR）+ `workspace/`（cwd）；**已与本地 `~/.claude` 隔离** |

> 开发模式下 `~/.inkpress` 通常只有 `cache/claude-agent/` 会被写入（DB / storage 仍在项目内）。若曾跑过桌面形态，`~/.inkpress` 会留有完整数据目录。

## 八、DMG 部署环境完整清单

用户数据统一归属 `~/.inkpress`；只读资源固化在 `/Applications/InkPress.app/Contents/Resources/`。

### 8.1 用户数据（`~/.inkpress`，运行时写入，升级不覆盖）

| 子路径 | 内容 | 创建者 |
|---|---|---|
| `database/inkpress.db` | SQLite DB | `instrumentation.ts` 建表 |
| `database/backups/` | 迁移前 DB 备份（滚动 5 份） | `runMigrations` |
| `database/scripts/<ts>/` | 迁移脚本留档 + `.success` 审计 | `runMigrations` |
| `storage/articles/` | 文章正文 `<id>.md` | 文章保存 |
| `storage/spaces/<id>/` | 按空间隔离文章 | |
| `storage/library/` | 统一存储素材 | 素材上传 |
| `storage/code-sources/<key>/snapshots/` | 代码源快照 | |
| `storage/technical-documents/` | 技术文档正文 | |
| `cache/` | 临时文件 / 分片缓存 | `cacheDir()` |
| `cache/claude-agent/config/` | **Claude SDK 配置 / transcript**（CLAUDE_CONFIG_DIR） | `buildClaudeAgentOptions` |
| `cache/claude-agent/workspace/` | **Claude SDK 工作目录**（cwd） | 同上 |
| `resources/skills/user/` | 用户创建 / AI 生成 / 上传的 skill | 永不被 app 更新触碰 |
| `logs/inkpress.log` | 运行日志（20MB × 5 滚动） | pino |
| `.update` | 安装版本 + 时间戳标记 | `init.ts` |

### 8.2 只读资源（`/Applications/InkPress.app/Contents/Resources/`，随包分发，整包替换更新）

| 子路径 | 内容 | 打包来源 |
|---|---|---|
| `standalone/server.js` + `.next/` | Next.js standalone server | `prepare-standalone` 产出 |
| `standalone/node_modules/` | 运行时依赖（已物化 pnpm symlink，含 better-sqlite3 原生绑定） | extraResources 单独 entry |
| `themes/` | 内置主题 CSS | `themes/` |
| `resources/skills/system/` | 系统 skill 原件（只读，实时读取） | `resources/skills/system/` |
| `migrations/` | Prisma 迁移脚本源 | `prisma/migrations/` |

启动链路：主进程 `ensureDirs()` 建目录 → spawn server 子进程（注入 `DATABASE_URL` / `INKPRESS_HOME` / `RESOURCE_ROOT` / `ELECTRON_RUN_AS_NODE=1`）→ server `instrumentation.ts` 建表 + 迁移 + seed → BrowserWindow 加载 `http://127.0.0.1:<port>`。

## 九、Docker 服务端部署（同构对照）

```bash
docker compose up -d   # 卷：./inkpress-data → /data（= INKPRESS_HOME）
```

| 项 | 值 |
|---|---|
| 用户数据根 | `/data`（容器内），宿主机 `./inkpress-data/` |
| DB | `/data/database/inkpress.db` |
| 存储 / 缓存 / 日志 / Claude SDK | `/data/storage`、`/data/cache`、`/data/logs`、`/data/cache/claude-agent` |
| 只读资源根 | `/app/standalone`（`ENV RESOURCE_ROOT=/app/standalone`） |
| 运行时 | 标准 Node（无 Electron ABI 问题），`node server.js` |

## 十、验证方法

```bash
# 开发：确认 Claude SDK 已隔离（应输出 ~/.inkpress 路径，而非 ~/.claude）
ls -la ~/.inkpress/cache/claude-agent/
# 开发：确认 DB / storage 在项目内
ls dev.db storage/ logs/

# DMG：确认用户数据目录结构
find ~/.inkpress -maxdepth 2
tail ~/.inkpress/logs/inkpress.log          # 应无 error
# DMG：确认只读资源在 .app bundle
ls "/Applications/InkPress.app/Contents/Resources/"
# DMG：前台启动排查 server 子进程（崩溃通常不写日志）
"/Applications/InkPress.app/Contents/MacOS/InkPress" 2>&1 | tee /tmp/inkpress.log

# 三方隔离核对：InkPress SDK 与本地 Claude Code 应无路径交集
diff <(find ~/.inkpress/cache/claude-agent -type f 2>/dev/null) \
     <(find ~/.claude -type f 2>/dev/null)   # 期望：无共同文件
```

## 附：关键文件索引

| 文件 | 作用 |
|---|---|
| `src/lib/paths.ts` | 路径解析统一入口（本文件所有路径的事实来源） |
| `electron/main.ts` | Electron 主进程：建目录、spawn server、注入 `INKPRESS_HOME` / `RESOURCE_ROOT` |
| `src/lib/init.ts` | `ensureDataHome()`：首次启动初始化、版本化迁移、seed |
| `src/lib/migration.ts` | `runMigrations()`：打包形态的幂等迁移 runner |
| `src/lib/ai/claude-agent-options.ts` | Claude Agent SDK Options 构造（CLAUDE_CONFIG_DIR / cwd / sessionStore） |
| `src/lib/ai/claude-session-store.ts` | Prisma SessionStore（transcript 镜像到 DB） |
| `src/lib/logger.ts` | pino 日志（双路输出 + 滚动） |
| `prisma/schema.prisma` | 数据模型（SQLite） |
| `scripts/prepare-standalone.ts` | 打包前处理 standalone bundle（物化 / 补全 / 复制只读资源） |
| `docs/packaging.md` / `docs/packaging-analysis.md` | 打包链路与脆弱点全记录 |

## 十一、待改进项与优化方案（实施跟踪）

> 本节是运行时路径 / 存储体系的加固计划。状态：✅ 已落地 / ⏳ 部分落地（余项见说明）/ 📌 仅立规矩（暂不动代码）。

### 两个细节优化

| # | 问题 | 方案 | 状态 |
|---|---|---|---|
| 细节 1 | `dataHome()` 与 `inkpressHomeDir()` 不对称；`isPackaged` 在 `dataHome()` 中存在不可达分支；Claude 运行时目录不可覆盖、开发态无日志提示 | 删除不可达分支；`claudeAgentRuntimeDir()` 增加 `INKPRESS_CLAUDE_RUNTIME_DIR` 覆盖入口；开发态打印解析路径。不对称本身保留（开发态隔离是正确设计） | ✅ |
| 细节 2 | `<项目>/storage/tmp/claude/` 为重构前遗留，现行代码不再写入 | 手动删除 + `ensureDataHome()` 加幂等遗留清理（dev/打包都跑） | ✅ |

### 整体设计不足（按优先级）

#### P0 — 数据安全 / 正确性

| # | 不足 | 方案 | 状态 |
|---|---|---|---|
| B1 | 无单实例锁 → 双开两进程写同一 SQLite，last-write-wins + `SQLITE_BUSY` | `app.requestSingleInstanceLock()`；二次启动聚焦已有窗口，未获锁直接退出 | ✅ |
| B2 | 迁移单向、无版本守卫 → 降级打开新 schema 库静默错乱 | `runMigrations` 比对「DB 已应用版本 ∖ app 迁移目录已知版本」，若非空则抛 `DatabaseVersionError`；instrumentation 捕获后 `process.exit(1)` | ✅ |

#### P1 — 健壮性 / 可维护性

| # | 不足 | 方案 | 状态 |
|---|---|---|---|
| B3 | `dataHome()` 返回 null → 每个路径函数双分支 | 📌 仅立规矩：新增路径函数不再加 `process.cwd()` 分支；长期收敛待 dev DB 迁移配套（本次不动，避免改变 dev DB 位置影响 `prisma migrate` 工作流） | 📌 |
| B4 | `appVersion()` 靠 `process.cwd()/package.json`，脆弱 | 构建期注入 `APP_VERSION`（next.config `env` + Electron `app.getVersion()` 透传），运行时优先读 env | ✅ |
| B5 | 打包注入 `DATABASE_URL` 与开发 `databaseUrl()` 两条路径，易冲突 | `db.ts` 统一：env 已设则用之，否则 `dbPath()`；启动日志打印实际生效路径 | ✅ |
| B6 | `CLAUDE_CONFIG_DIR`（config/）与 DB `ClaudeAgentSessionEntry` 双写，生命周期/GC 无对账 | 已核实：SDK 把完整 transcript JSONL 落到 `config/projects/<key>/`（实测 2 天 5.4MB），与 DB 镜像重复；DB 是 resume 事实源，故按 30 天（`INKPRESS_CLAUDE_TRANSCRIPT_RETENTION_DAYS` 可调）清理磁盘 transcript，写入统一 cache GC | ✅ |

#### P2 — 体验 / 加固 / 平台约定

| # | 不足 | 方案 | 状态 |
|---|---|---|---|
| B7 | API key / token / secret 明文存 DB | at-rest AES-256-GCM 加密（安装级密钥 `~/.inkpress/.secret`，0600）；敏感字段表集中于 `src/lib/config-secrets.ts`，覆盖 LLM、OSS/storage、Agent、联网搜索、微信凭证；读时惰性迁移、写时幂等加密；密钥丢失返回空串引导重填。完整 Keychain 集成（key 读取改走 main IPC）列为后续 | ✅ |
| B8 | 缓存 GC 碎片化（code-index 已有，其余子目录无统一策略） | 统一 cache GC：通用 7 天 mtime 清理 + Claude transcript 30 天清理，启动 + 每日定时（`src/lib/cache-gc.ts`） | ✅ |
| B9 | 无数据导出 / 重置入口 | 导出 `GET /api/settings/data`（zip `~/.inkpress` 去掉 cache/logs/.reset，含 .secret 便于迁移）+ 恢复出厂 `POST /api/settings/data/reset`（写 .reset 标记，主进程下次启动兑现）；**导入列为后续** | ⏳ |
| B10 | 日志位置不遵 macOS 约定，级别仅 env 可调 | 保留 `~/.inkpress/logs`（自包含设计优先）；新增运行时日志级别 API（持久化到 SystemConfig，启动应用） | ✅ |
| B11 | DB 备份按份数滚动，无总量上限 / 校验 | 总量上限 + sha256 校验写入 `.success` 同级 manifest | ✅ |
| B12 | 路径硬编码 `.inkpress`（unix 风），未来跨平台需调整 | `defaultDataHome()` 按 platform 选目录（mac 保持 `~/.inkpress` 不破坏存量） | ✅ |

> ⏳ 项的"未竟部分"在代码注释与下文实施说明里标注，便于后续接续。

## 十二、实施说明（落地记录）

### 改动文件一览

| 关注点 | 文件 |
|---|---|
| 路径解析（细节1 / B12） | `src/lib/paths.ts`、`electron/main.ts`（同构 `defaultDataHome`） |
| 首启初始化（dev 日志 / 细节2 清理） | `src/lib/init.ts` |
| 单实例锁 / 快速失败 / 版本透传（B1 / B2 快速失败 / B4） | `electron/main.ts` |
| 版本守卫（B2） | `src/lib/migration/runner.ts`（`DatabaseVersionError`）、`src/instrumentation.ts`（exit 1） |
| 构建期版本（B4） | `next.config.ts`（`env.APP_VERSION`）、`src/lib/init.ts`（`appVersion` 优先 env） |
| DB URL 统一（B5） | `src/lib/paths.ts`（`resolveDbPath`）、`src/lib/db.ts` / `src/lib/init.ts`（共用解析结果 + 来源日志） |
| 缓存 GC（B8 / B6） | `src/lib/cache-gc.ts`（通用 + Claude transcript） |
| 日志级别（B10） | `src/lib/logger.ts`（`setLogLevel`）、`src/lib/log-level.ts`、`src/app/api/settings/log-level/route.ts`、`src/instrumentation.ts` |
| 备份加固（B11） | `src/lib/migration/backup.ts`（总量上限 + sha256 sidecar） |
| 敏感配置加密（B7） | `src/lib/crypto/secret-store.ts`、`src/lib/config-secrets.ts`、`src/lib/ai/llm-config.ts`、`src/lib/{ai/agent-config,ai/web-research-config,storage-config,wechat/config}.ts`、`src/app/api/system-config/route.ts`（写加密）、`src/app/api/system-config/export-raw/route.ts`（导出解密） |
| 数据导出 / 重置（B9） | `src/lib/data-portability.ts`、`src/app/api/settings/data/route.ts`、`src/app/api/settings/data/reset/route.ts`、`electron/main.ts`（`performResetIfMarked`） |
| 测试 | `tests/unit/secret-store.test.ts`（B7 round-trip / 幂等 / 惰性迁移 / 损坏回空）、`tests/unit/config-secrets.test.ts`（SystemConfig 字段表加/解密） |

### 新增环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `INKPRESS_CLAUDE_RUNTIME_DIR` | 覆盖 Claude Agent SDK 运行时目录（测试 / dev 隔离） | `<inkpressHome>/cache/claude-agent` |
| `APP_VERSION` | 注入 app 版本（next.config 构建期 / Electron main 透传） | 读 package.json |
| `INKPRESS_CLAUDE_TRANSCRIPT_RETENTION_DAYS` | Claude 磁盘 transcript 保留天数 | 30 |

### 新增 API

| 方法 / 路径 | 作用 |
|---|---|
| `GET /api/settings/log-level` | 读取持久化 / 生效日志级别 + 合法集合 |
| `PUT /api/settings/log-level` | `{ level }` 持久化 + 即时应用 |
| `GET /api/settings/data` | 下载数据导出 zip |
| `POST /api/settings/data/reset` | `{ "confirm": "RESET" }` → 标记恢复出厂（重启兑现） |

### 未竟项（后续接续）

- **B3 完整收敛**：`dataHome()` 仍允许 null（dev 回落项目根），故新增路径函数仍需双分支。本次仅立规矩（不再新增 `process.cwd()` 分支）；彻底统一需配套迁移 dev DB 位置，影响 `prisma migrate dev` 工作流，单列演进。
- **B7 完整 Keychain**：当前为安装级 `.secret` 对称加密（defense-in-depth，DB 单独泄露不暴露 key，但密钥与 DB 同机共存）。完整 macOS Keychain 集成需把 key 读取改走 Electron main 进程 IPC（server 以 `ELECTRON_RUN_AS_NODE` 运行，无法直接用 `safeStorage`），属架构演进。
- **B9 导入**：导出 + 重置已落地；导入（解 zip 还原数据目录 + 校验）作为后续，需处理跨版本 schema 与 .secret 冲突。
- **B10 stream 级别**：`setLogLevel` 改根 logger 过滤；多路输出 stream 自身级别不变，故完整生效建议重启。

### 验证

- `pnpm typecheck`（主 app）+ `tsc -p tsconfig.electron.json --noEmit`（Electron 主进程）均通过。
- `pnpm test`：38 文件 / 302 项测试全绿（含 `llm-config.test.ts` 覆盖的 B7 读路径，惰性迁移兼容明文）；新增 `secret-store.test.ts` 5 项和 `config-secrets.test.ts` 3 项覆盖 B7 关键不变量。
- 未提交：按项目约定仅报告改动，等待显式 `git commit`。
