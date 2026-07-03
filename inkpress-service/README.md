# inkpress-service

InkPress 用户服务、认证、License 与管理后台服务。**独立 Node 项目**，只通过公网 API 与 InkPress 主应用通信，不与主项目共享运行时、数据库、依赖或构建产物。

> 设计契约见 `../docs/service/inkpress-service-pdc.md`。本文档对应 **Phase 1（认证骨架）+ Phase 2（License 管理）+ Phase 3（客户端 License API）+ Phase 4（安全加固与运维）**。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16 App Router + React 19 + TypeScript |
| 认证 | Auth.js v5（NextAuth）：Credentials + GitHub OAuth，JWT session |
| 数据 | Prisma 7 + SQLite（`/data/inkpress-service.db`） |
| UI | Tailwind CSS v4 + shadcn/Radix 风格（与主应用一致） |
| 校验 | Zod 4 |
| 密码 | argon2id（`@node-rs/argon2`） |
| 日志 | pino（结构化，敏感字段 redact） |
| 邮件 | 可插拔 adapter：console / smtp(nodemailer) / resend |
| 部署 | Docker / Docker Compose，Node 22 LTS |

## 前置条件

- Node 22
- pnpm 11（`corepack enable`）

## 本地开发

```bash
cd inkpress-service
cp .env.example .env          # 按需填写
pnpm install
pnpm db:generate              # 生成 Prisma client
pnpm db:migrate               # 创建/迁移 SQLite
pnpm init-admin               # 幂等初始化管理员（仅无 ADMIN 时生效）
pnpm dev                      # http://localhost:3001
```

开发模式 `MAIL_PROVIDER=console`，注册验证码会打印到控制台并写入 `data/dev-mail.log`。

## 环境变量

见 `.env.example`。关键项：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | 开发 `file:./dev.db`；生产 `file:/data/inkpress-service.db` |
| `NEXTAUTH_SECRET` | session 加密密钥（`openssl rand -base64 32`） |
| `NEXTAUTH_URL` | 服务公网地址 |
| `SECURE_COOKIES` | 生产 HTTPS 设 `true` |
| `GITHUB_ID` / `GITHUB_SECRET` | GitHub OAuth，留空则不启用 |
| `NEXT_PUBLIC_GITHUB_ENABLED` | 设 `1` 时前端显示 GitHub 登录按钮 |
| `MAIL_PROVIDER` | `console` / `smtp` / `resend` |
| `SMTP_*` / `RESEND_API_KEY` | 对应 provider 配置 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 首次初始化管理员；仅无 ADMIN 时生效，首登强制改密 |
| `LICENSE_KEY_PEPPER` | License Key 哈希 pepper（`openssl rand -base64 32`） |
| `ACTIVATION_SECRET_KEK` | activationSecret AES-256 加密密钥（`openssl rand -base64 32`） |
| `LICENSE_TOKEN_PRIVATE_KEY` / `LICENSE_TOKEN_PUBLIC_KEY` | licenseToken Ed25519 签名密钥（`pnpm gen-token-key`）；缺省开发态惰性生成临时密钥 |
| `MAIL_TIMEOUT_SEC` | 发件超时秒数（SMTP/Resend，默认 10） |
| `LOG_LEVEL` | 默认 `info` |
| `SECURITY_HEADERS_ENABLE` | 安全响应头开关（CSP/HSTS/X-Frame 等），默认 `true` |
| `BACKUP_RETENTION` | `db:backup` 保留最近 N 份（默认 14） |
| `RISK_DISABLE` | 异常风控总开关，`true` 关闭 |
| `RISK_ACTIVATION_FAIL_THRESHOLD` / `_WINDOW` | 激活失败封禁阈值（默认 20 次）/ 窗口秒（默认 600） |
| `RISK_SIGNATURE_FAIL_THRESHOLD` / `_WINDOW` | 签名/重放失败封禁阈值（默认 30 次）/ 窗口秒（默认 600） |
| `RISK_BLOCK_MINUTES` | 命中阈值后封禁分钟数（默认 30） |

## 管理员初始化

`ADMIN_EMAIL` + `ADMIN_PASSWORD` 仅在数据库中**不存在任何管理员**时生效（幂等）。创建后 `mustChangePassword=true`，首次登录需在 Dashboard 修改密码。

```bash
pnpm init-admin     # 或 pnpm db:seed
```

后续管理员通过数据库或管理后台提升（Phase 2）。

## Docker 部署

```bash
cp .env.example .env           # 填写生产配置（NEXTAUTH_SECRET 等）
docker compose up -d --build   # http://localhost:3001
```

- 端口映射 `3001:3000`，SQLite 持久化到 `./data:/data`
- 容器启动自动执行 `prisma migrate deploy`，再启动 Next standalone server
- 备份：备份 `./data` 目录即可

## API（Phase 1）

统一响应：`{ ok: true, data, requestId }` 或 `{ ok: false, error: { code, message }, requestId }`。

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| `POST` | `/api/auth/email-code/send` | 发送注册验证码（限流） | public |
| `POST` | `/api/auth/register` | 邮箱 + 密码 + 验证码注册 | public |
| `GET/POST` | `/api/auth/[...nextauth]` | Auth.js（登录 / 回调） | NextAuth |
| `GET` | `/api/me` | 当前用户信息 | session |
| `GET` | `/api/me/invitation-code` | 当前用户邀请码 | session |
| `GET` | `/api/me/licenses` | 当前用户邀请归因的 License 概况 | session |
| `POST` | `/api/me/password` | 修改密码（含首登强制改密） | session |
| `GET` `POST` | `/api/admin/licenses` | License 列表 / 创建（明文仅返一次） | ADMIN |
| `GET` `PATCH` | `/api/admin/licenses/:id` | 详情（设备/校验日志）/ 禁用·启用·撤销·改备注 | ADMIN |
| `POST` | `/api/admin/licenses/:id/activations/:activationId/revoke` | 解绑/撤销某台设备 | ADMIN |
| `GET` | `/api/admin/users` | 用户列表（email/status/role 查询） | ADMIN |
| `PATCH` | `/api/admin/users/:id` | 禁用/启用/改角色 | ADMIN |
| `GET` | `/api/admin/audit-logs` | 管理操作审计日志 | ADMIN |
| `POST` | `/api/v1/licenses/activate` | 输入 License Key 激活当前设备（明文 `activationSecret` 仅返一次） | public |
| `POST` | `/api/v1/licenses/validate` | 启动/定时校验激活状态（HMAC 签名 + nonce 防重放） | 签名 |
| `POST` | `/api/v1/licenses/deactivate` | 用户主动解绑本设备（签名） | 签名 |

错误码见 PDC §13（`EMAIL_CODE_INVALID` / `EMAIL_ALREADY_REGISTERED` / `RATE_LIMITED` / `LICENSE_INVALID` / `DEVICE_LIMIT_EXCEEDED` / `SIGNATURE_INVALID` / `REPLAY_DETECTED` 等）。

### 客户端 License API（Phase 3，PDC §4-5、§7）

`/api/v1/licenses/*` 是面向 InkPress 客户端的公网机器接口，不走 NextAuth session：

- **activate**：明文 License Key 哈希匹配 → 幂等激活（同 key+同设备返回原 activationId）→ 首次激活计算所有设备共用的 `effectiveExpiresAt` → 设备数以 `ACTIVE` 计数限制 → 返回 Ed25519 签发的 `licenseToken` 与对称 `activationSecret`（仅本次，AES-256-GCM 加密入库）。
- **validate / deactivate**：请求需带 `X-InkPress-{Client-Id,Device-Id,Timestamp,Nonce,Signature}` 头，`Signature = HMAC_SHA256(activationSecret, method\npath\ntimestamp\nnonce\nsha256(body).hex)`；服务端校验时间偏差 ≤5min → HMAC 验签 → nonce 10 分钟防重放（仅验签通过后登记 nonce）。validate 的业务态以 `200 + status`（`ACTIVE/EXPIRED/DISABLED/REVOKED/DEVICE_MISMATCH`）返回，仅 `ACTIVE` 刷新并重签 token。

密钥管理：Ed25519 keypair 由 `pnpm gen-token-key` 生成填入 env；`ACTIVATION_SECRET_KEK` 为 AES 密钥。开发环境三者留空会惰性派生临时密钥（仅本地）。

## 页面

| 路径 | 说明 |
|---|---|
| `/login` | 邮箱密码登录、GitHub 登录 |
| `/register` | 邮箱验证码注册（60s 冷却 + 多维限流） |
| `/dashboard` | 账户信息、邀请码、归因 License 概况、首登改密、管理员入口 |
| `/admin/licenses` | License 列表/筛选/生成（明文一次性弹窗+复制） |
| `/admin/licenses/:id` | 详情：激活设备、校验日志、归因、禁用/启用/撤销/解绑 |
| `/admin/users` | 用户状态/角色/邀请码（角色下拉、禁用启用，防自锁） |
| `/admin/audit-logs` | 管理操作审计记录 |

## 限流策略（PDC §9.3）

| 场景 | 限制 |
|---|---|
| 发送验证码 | 每邮箱 60s 1 次、10min 5 次、24h 20 次；每 IP 1h 30 次 |
| 注册 | 每 IP 1h 20 次 |
| License 激活 | 每 IP 每分钟 20 次、每 key 每小时 30 次 |
| License 校验 | 每 activation 每分钟 10 次、每 IP 每分钟 120 次 |

单实例内存滑动窗口；多实例迁移 Redis。

## 安全加固与运维（Phase 4）

### 安全响应头（PDC §9.1）

`next.config.ts` 的 `headers()` 统一下发：`Content-Security-Policy`、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Permissions-Policy`，生产 HTTPS（`SECURE_COOKIES=true`）追加 `Strict-Transport-Security`。CSP 针对本服务小型管理 UI 调校（脚本 `self`，样式放开 `unsafe-inline` 以兼容 Tailwind v4/shadcn）。排障时 `SECURITY_HEADERS_ENABLE=false` 临时关闭。

### 异常风控（PDC §9.3/§9.4）

与限流叠加的另一层防线：限流按「请求计数」限速，风控按「**失败结果模式**」识别攻击（License key 枚举、签名爆破）并临时封禁来源 IP。

- `activate` 命中模糊化 `LICENSE_INVALID` → 计 `ACTIVATION_FAILED` 信号
- `validate`/`deactivate` 命中 `SIGNATURE_INVALID`/`REPLAY_DETECTED` → 计 `SIGNATURE_FAILED` 信号
- 信号在滑动窗口内累计超阈值（`RISK_*` env 可调）→ 该 IP 封禁 `RISK_BLOCK_MINUTES` 分钟，期间三接口直接 `RATE_LIMITED`（`reason=risk:blocked`，写 `LicenseValidationLog`）
- `RISK_DISABLE=true` 可整体关闭；单实例内存存储，多实例迁移 Redis

### 数据库备份（PDC §11）

```bash
pnpm db:backup     # 在线备份（better-sqlite3 Online Backup，运行中安全），保留最近 BACKUP_RETENTION 份
```

产物在 `./backups/inkpress-service-<ts>.db`。Docker 下 `/data` 卷应另挂持久备份卷。cron 示例：

```bash
0 3 * * * cd /app/inkpress-service && pnpm db:backup >> logs/backup.log 2>&1
```

恢复：停服 → `cp backups/<最新>.db /data/inkpress-service.db` → 重启。

### 日志脱敏（PDC §9.2）

pino `redact` 覆盖 `password`/`code`/`licenseKey`/`licenseToken`/`secret`/`apiKey`/`*Hash`/`*Enc` 等字段；`src/lib/security/mask.ts` 提供 `maskLicenseKey`（`INKP-****-XXXX`）/`maskEmail` 显式脱敏，用于需保留可辨识指纹的日志。

## 项目结构

```text
inkpress-service/
  prisma/            schema.prisma / seed.ts / migrations
  scripts/           init-admin.ts
  src/
    app/             (api / login / register / dashboard / layout)
    components/      ui(primitives) / dashboard
    lib/             auth / db / email / rate-limit / security / validation ...
    auth.ts          Auth.js 完整配置（Node）
    auth.config.ts   Auth.js edge 安全配置（middleware）
    middleware.ts    /dashboard /admin 路由保护
  Dockerfile / docker-entrypoint.sh / docker-compose.yml
```

## Phase 范围与后续

已完成：
- **Phase 1**：服务骨架、Prisma + Auth.js（Credentials + GitHub）、邮箱验证码注册、密码登录、用户/角色/邀请码、限流、邮件 adapter、Docker 部署、init-admin。
- **Phase 2**：LicenseKey/LicenseActivation/LicenseValidationLog/AuditLog 模型；管理员生成（`INKP-` 格式、peppered 哈希、明文不入库/日志/列表）/禁用/撤销/解绑 License；License 列表与详情；用户管理（状态/角色，防降级最后一个管理员）；审计日志；邀请码归因（管理端 + 用户端 `/api/me/licenses` 与 Dashboard 概况）。
- **Phase 3**：客户端 License API `/api/v1/licenses/{activate,validate,deactivate}`；Ed25519 签发的 `licenseToken`；AES-256-GCM 加密存储的 `activationSecret` + HMAC 请求签名；timestamp/nonce 防重放；激活/校验/解绑限流；每次请求写 `LicenseValidationLog`；`gen-token-key` 密钥脚本；mock 端到端冒烟（`scripts/smoke/v1-license-smoke.mjs`）。
- **Phase 4**：安全响应头（CSP/HSTS/X-Frame 等，`next.config.ts`）；SQLite 在线备份脚本（`pnpm db:backup`）；日志脱敏完善 + `maskLicenseKey`/`maskEmail`；邮件 Provider 加固（SMTP `verify()` 连接校验 + `MAIL_FROM` 校验、Resend 超时）；异常风控（失败信号模式触发 IP 临时封禁，`RISK_*` env 可调）。

后续：
- InkPress 主应用接入（激活页/启动校验/`licenseGuard`/设备指纹/Keychain 本地安全存储）；客户端代码混淆、asar/签名/完整性校验、本地异常上报。
- 多实例 Redis 化的限流/风控（PDC §9.3 后续演进）。
