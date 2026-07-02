# Code Review Handoff — 运行时路径 / DB / 文件存储 加固

> 目的：把本批改动交给另一个 AI review。读这份 + `git diff`（未提交）+ `docs/runtime-paths-and-storage.md`（设计/落地文档）即可独立审查。
> 改动尚未 commit（项目约定：不主动提交）。所有改动为工作区未暂存/未跟踪状态，用 `git status` + `git diff` 查看。

## 零、给 reviewer 的速读

- **目标**：在不动 dev 使用习惯的前提下，加固 InkPress 桌面应用（Electron + Next standalone + SQLite/Prisma）的运行时路径、DB、文件存储与 Claude Agent SDK 工作目录，并保证与本地 `~/.claude` 隔离。共 14 项（2 个细节优化 + 12 个 B 项），优先级 P0→P2。
- **设计文档**：`docs/runtime-paths-and-storage.md`（第十一节是计划+状态表，第十二节是落地记录/文件清单/env/API/未竟项）。
- **验证基线**：`pnpm typecheck` 通过；`pnpm test` = 38 文件 / 302 项全绿、0 error（含新增 `tests/unit/secret-store.test.ts`、`tests/unit/config-secrets.test.ts`）。
- **审查结论建议格式**：可沿用项目 `code-review-skills` 四维（业务功能实现 / 代码质量 / 架构合理性 / 项目 rules），或自由格式。重点请落在下方「五、重点怀疑区」。

## 一、改动清单（按关注点）

### 路径解析（细节1 / B12）
- `src/lib/paths.ts`
  - 删 `dataHome()` 中**不可达**的 `if (isPackaged)` 分支（`isPackaged ⟺ !!INKPRESS_HOME`，被前一个 `if` 完全覆盖）。
  - 新增 `defaultDataHome()`（mac=`~/.inkpress` 不变 / win=`%APPDATA%\InkPress` / linux=`$XDG_DATA_HOME/inkpress`）；`inkpressHomeDir()` 改用它。
  - `claudeAgentRuntimeDir()` 增加 `INKPRESS_CLAUDE_RUNTIME_DIR` 覆盖入口。
- `electron/main.ts` 同构 `defaultDataHome()`（main.ts 自包含、不 import src/lib）。

### 首启初始化（dev 日志 / 细节2 清理）
- `src/lib/init.ts`：`ensureDataHome()` 顶部打印 `{dataHome, dbPath, claudeAgentRuntimeDir}`；新增 `cleanupLegacyClaudeDir()` 幂等删除 `<storage>/tmp/claude`（重构前 `CLAUDE_CONFIG_DIR` 旧位置）。

### Electron 主进程（B1 / B2 快速失败 / B4 / B9 reset）
- `electron/main.ts`：
  - **B1** `app.requestSingleInstanceLock()`：未获锁 `app.quit()`；`second-instance` 聚焦已有窗口。
  - **B2 快速失败** bootstrap 中 `Promise.race([waitForServer, earlyExit])`：server 在启动期退出立即 reject（不再等 30s 超时）。
  - **B4** spawn server 时注入 `env.APP_VERSION = app.getVersion()`。
  - **B9** `performResetIfMarked()`：启动时若存在 `~/.inkpress/.reset` 则清空数据目录后重建。

### 版本守卫（B2）
- `src/lib/migration/runner.ts`：新增 `DatabaseVersionError`；`runMigrations` 在收集 applied/known 后做差集，若 DB 已应用版本 ∖ app 迁移目录已知版本 ≠ ∅ → 抛错。
- `src/instrumentation.ts`：捕获 `DatabaseVersionError`（按 `e.name` 判定）→ `process.exit(1)`。

### 构建期版本（B4）
- `next.config.ts`：`env.APP_VERSION` 注入（读 package.json）；`src/lib/init.ts` `appVersion()` 优先 `process.env.APP_VERSION`。

### DB URL 统一（B5）
- `src/lib/paths.ts`：`resolveDbPath()` 优先 `process.env.DATABASE_URL`（接受 `file:` 前缀与裸路径），否则 `paths.dbPath()`；`src/lib/db.ts` 与 `src/lib/init.ts` 共用该入口，避免 Prisma 与 migration 指向不同 DB；启动日志带来源。

### 缓存 GC（B8 / B6）
- `src/lib/cache-gc.ts`（新建）：`runCacheGc()`（通用 7 天 mtime 清理，跳过 `claude-agent`/`code-index`）+ `runClaudeTranscriptGc()`（清 `config/projects/**/*.jsonl`，默认 30 天，`INKPRESS_CLAUDE_TRANSCRIPT_RETENTION_DAYS` 可调）+ `startCacheGcScheduler()`（启动跑一次 + 每日，`unref`）。
- `src/instrumentation.ts` 启动调度。

### 日志级别（B10）
- `src/lib/logger.ts`：`setLogLevel()`；`src/lib/log-level.ts`（新建，SystemConfig `inkpress.log-level` 持久化）；`src/app/api/settings/log-level/route.ts`（新建，GET/PUT）；instrumentation 启动应用。

### 备份加固（B11）
- `src/lib/migration/backup.ts`：写 `<backup>.sha256sum` sidecar；`rotateBackups` 双维度（份数 5 + 总量 500MB），删备份时同步删 sidecar。

### 敏感配置 at-rest 加密（B7）⚠️ 高风险
- `src/lib/crypto/secret-store.ts`（新建）：AES-256-GCM，信封 `v1:<iv>:<tag>:<ct>`；安装级密钥 `~/.inkpress/.secret`（0600）；`encryptSecret` 幂等、`decryptSecret` 对非 `v1:` 直通（惰性迁移）、解密失败返回 `""`。
- `src/lib/config-secrets.ts`（新建）：集中维护 SystemConfig 敏感字段表；当前覆盖 `inkpress.llm[].apiKey`、`inkpress.oss.accessKeySecret`、`inkpress.storage.providers.aliyunOss.accessKeySecret`、`inkpress.agent.tavilyApiKey/githubToken`、`inkpress.web-research.tavilyApiKey`、`inkpress.wechat.secret`。
- `src/lib/ai/llm-config.ts`：`getLlmConfigs` 读出后 `decryptSecret(c.apiKey)`；新增 `encryptLlmConfigValueForStorage()`；`migrateClaudeAgentConfig` 落库前 `encryptSecret`。
- `src/lib/{ai/agent-config,ai/web-research-config,storage-config,wechat/config}.ts`：运行时读取前解密对应敏感字段。
- `src/app/api/system-config/route.ts`：`prepareValueForStorage()`（POST/PUT 落库前对敏感字段加密）。
- `src/app/api/system-config/export-raw/route.ts`：配置导出前解密敏感字段；导出文件仍由浏览器端密码二次加密。

### 数据导出 / 重置（B9）
- `src/lib/data-portability.ts`（新建）：`buildDataExportZip()`（zip `~/.inkpress` 去掉 `cache`/`logs`/`.reset`，**保留 `.secret`**）、`writeResetMarker()`。
- `src/app/api/settings/data/route.ts`（新建）：`GET` 下载 zip。
- `src/app/api/settings/data/reset/route.ts`（新建）：`POST` 写 reset 标记。
- 测试：`tests/unit/secret-store.test.ts`（5 项）、`tests/unit/config-secrets.test.ts`（3 项）。

## 二、不变量清单（逐项 check）

| 项 | 不变量 |
|---|---|
| 细节1 | dev（无 INKPRESS_HOME）下 `dataHome()===null`、`dbPath()===$CWD/dev.db`、`claudeAgentRuntimeDir()` 仍=`~/.inkpress/cache/claude-agent`；打包下二者一致指向 `~/.inkpress`。`INKPRESS_CLAUDE_RUNTIME_DIR` 设置后覆盖。 |
| 细节2 | `cleanupLegacyClaudeDir` 目录不存在时不报错、不误删其它目录。 |
| B1 | 首个实例正常起；第二个实例立即退出并聚焦首个窗口；不出现两个 server 进程写同一 DB。 |
| B2 | 正常升级（applied ⊆ known）不抛；降级（applied 含未知版本）抛 `DatabaseVersionError` 且 server 进程退出（非被 instrumentation 吞掉）。 |
| B4 | 打包态 `appVersion()` 读到真实版本（不依赖 cwd/package.json）；`~/.inkpress/.update` 写入正确版本。 |
| B5 | 无 env 时用 `dbPath()`；有 `DATABASE_URL` 时用之并打印来源；**与 runMigrations 操作的库一致**。 |
| B6 | transcript GC 仅删 `config/projects/**/*.jsonl` 且 mtime>保留期；不碰 `.claude.json`/`sessions/`/`backups/`/活跃会话；不误删非 claude-agent 目录。 |
| B7 | 运行时读路径全部经 decrypt（LLM / OSS storage / Agent GitHub+Tavily / web-research Tavily / Wechat secret 得到明文；公开设置接口仍脱敏）；写路径全部经 encrypt；幂等不二次加密；旧明文仍可读；`.secret` 权限 0600、不入 git。 |
| B8 | GC 仅 nodejs runtime 跑；定时器 `unref`；跳过自管子目录；清空产生的空目录。 |
| B9 | 导出包不含 cache/logs/.reset、含 .secret；reset 需 `{confirm:"RESET"}`；标记写入后主进程下次启动清空数据目录并重建（dev 无主进程→无效，已文档化）。 |
| B10 | PUT 非法级别 400；持久化后下次启动生效；根 logger level 实时改（stream 级需重启，已文档化）。 |
| B11 | `.sha256sum` 与备份同名；listBackups 不把 sidecar 当备份；总量超限时最旧优先删+清 sidecar。 |
| B12 | mac 路径与改动前一致（不破坏存量）；`defaultDataHome` 与 main.ts 同构。 |

## 三、env / API 增量（review 时核对）

- env：`INKPRESS_CLAUDE_RUNTIME_DIR`、`APP_VERSION`、`INKPRESS_CLAUDE_TRANSCRIPT_RETENTION_DAYS`。
- API：`GET|PUT /api/settings/log-level`、`GET /api/settings/data`、`POST /api/settings/data/reset`。
- 新文件：`src/lib/{cache-gc,log-level,data-portability,config-secrets}.ts`、`src/lib/crypto/secret-store.ts`、两个 API route、`tests/unit/{secret-store,config-secrets}.test.ts`、`docs/runtime-paths-and-storage.md`、本文件。

## 四、验证步骤

```bash
pnpm typecheck                                   # 主 app
npx tsc -p tsconfig.electron.json --noEmit       # Electron 主进程
pnpm test                                        # 37 文件 / 299 项（应全绿、0 error）
npx vitest run tests/unit/secret-store.test.ts tests/unit/config-secrets.test.ts   # 单跑 B7 加密不变量
```

可选手动（需起桌面/服务端，注意会写 `~/.inkpress/.secret`）：
- 设 LLM 配置 → 查 DB `SELECT value FROM SystemConfig WHERE key='inkpress.llm'` 应见 `v1:` 信封；前端设置页仍显 `********`；发一条对话应正常（读路径解密生效）。
- `PUT /api/settings/log-level {level:"debug"}` → 生效；重启后保持。
- `GET /api/settings/data` → 下载 zip，解压核对内含 `database/inkpress.db` + `.secret`、不含 `cache/`/`logs/`。

## 五、重点怀疑区（请优先证实/证伪）

> 这些是改动者实现时识别出的、最可能藏 bug 或设计权衡不当的点，请重点审查。

1. **B7 加密边界是否全覆盖**
   - Review 已扩展：敏感字段统一在 `src/lib/config-secrets.ts` 登记，写入和导出走通用转换，运行时读入口逐项解密。
   - 仍可重点核对是否还有新的直接读取 `SystemConfig` 并使用敏感字段的旁路（已发现并修复 `src/lib/ai/code-source.ts` 的 `parseAgentConfig(row?.value)` 旁路）。
   - `mergeMaskedSecrets`（system-config route）在用户提交 `********` 时会把 DB 中的**信封**复制回新值，再经 `encryptConfigValueForStorage`——`encryptSecret` 的幂等是否真的保证不二次加密？请追踪这条数据流。
   - `.secret` 是否被 `.gitignore` / 导出包正确处理（设计上导出**含** .secret 以便迁移；若你认为导出不该带密钥，这是设计分歧，请提出）。
   - 密钥丢失（用户删 .secret）→ 所有加密 key 解密返回 `""` → `chooseLlmConfig` 抛「未配置 AI 模型」。这个降级 UX 是否可接受？

2. **B2 守卫是否误伤合法用户**
   - `importLegacyPrismaHistory` 把旧 `_prisma_migrations` 全部导入为 applied。若其中某个迁移名**不在**当前 `migrationsDir()`（例如历史上被 squash/改名），守卫会拒绝启动——是否会把正常老用户挡在外面？请核对 `prisma/migrations` 与历史是否完全对齐。
   - `instrumentation.ts` 里 `process.exit(1)` 是否真生效（Next instrumentation 的异常处理会不会拦它）。exit 后 Electron `waitForServer` 是否如预期快速失败并弹错误窗。

3. **B5 DB 路径一致性**
   - ✅ Review 已修复：`resolveDbPath()` 已下沉到 `src/lib/paths.ts`，`runMigrations` 与 Prisma 客户端共用该入口；显式 `DATABASE_URL` 不再导致迁移库与读写库分裂。

4. **main.ts 退出监听器**
   - bootstrap finally 里 `serverProc?.removeAllListeners("exit")` 会把 `startServer` 中原本注册的 `[next] server exited` 日志监听一并移除，随后手动 re-add。确认：启动成功后正常运行期的 server exit 仍会被日志记录；且 `earlyExit` 的 once 监听确实被清掉（不会在后续 exit 触发未捕获 rejection）。

5. **B6 与 SDK 自管清理的冲突**
   - `config/` 下存在 `.last-cleanup`（SDK 自带 ~30 天清理）。InkPress 的 30 天 GC 与之并跑是否安全、是否可能删到 SDK 仍需 resume 的活跃 transcript（mtime 判定在长会话场景下的边界）。

## 六、故意未做（不要当缺陷报）

- **B3 彻底统一** `dataHome()` 仍允许 dev 返回 null（双分支保留），因为彻底统一要迁 dev DB 位置，会冲击 `prisma migrate dev` 工作流。本次仅立规矩「新增路径函数不再加 `process.cwd()` 分支」。文档第十二节已说明。
- **B7 完整 Keychain**：当前是安装级 `.secret` 对称加密（defense-in-depth）。完整 macOS Keychain 需把 key 读取改走 Electron main IPC（server 以 `ELECTRON_RUN_AS_NODE` 跑、无法直接用 `safeStorage`），属架构演进，文档已列。
- **B9 导入**：仅实现导出 + 重置；导入（解 zip 还原 + 跨版本 schema + .secret 冲突）为后续。
- **B10 stream 级别**：`setLogLevel` 改根 logger 过滤；多路输出 stream 自身级别不变，完整生效需重启。已文档化。
- dev 模式下 `/reset` 无效（无主进程兑现），文档已说明需手动清理。

## 七、项目 rules 提醒（来自 CLAUDE.md / memory）

- 路径/分发类逻辑倾向**声明式 registry + 数据驱动**（本次 B6/B8 沿用既定目录约定，未引入新硬编码分发）。
- 解析/路由类**LLM 主判、规则兜底**（本批为存储/运行时加固，不涉及该取舍）。
- **不主动 commit**（本批改动全部未提交）。
- 改代码后跑 `graphify update .`（已跑，图谱已更新）。
