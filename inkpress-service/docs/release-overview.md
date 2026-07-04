# InkPress Service 发布流程总览

> 本文是 inkpress-service 生产发布的**入口文档**，回答三个问题：
>
> 1. 发布架构长什么样？（§1）
> 2. 从零到上线要做什么？日常发版要做什么？（§2）
> 3. **哪些文件绝对不能进 git？如何自检？**（§3）
>
> 详细操作见同目录下的 4 篇专题文档（链接见 §4）。

---

## 1. 发布架构

### 1.1 分层镜像

```
inkpress-service-base:latest   ← 系统层（Node 22 + openssl + pnpm + 用户/目录）
        ▲
        │ FROM
        │
inkpress-service:latest        ← 应用层（base + node_modules + Next 产物 + Prisma）
```

- **base 镜像**：长期稳定，仅在 `Dockerfile.base` 变更（升级 Node、增减系统包）时重建。约 400 MB，一次构建长期复用。
- **app 镜像**：每次发版重建。基于 base，叠加本地产物。约 600 MB（新增 ~200 MB）。

### 1.2 端到端数据流

```
┌─────────────── 开发者 Mac ─────────────────────────────────────┐
│                                                                 │
│  bash scripts/release-local.sh                                  │
│    │                                                            │
│    ├─ Stage 1  pnpm install + prisma generate + pnpm build      │
│    ├─ Stage 2  组装 release/（standalone + static + Prisma）    │
│    ├─ Stage 3  rsync -az --exclude='*.pem' --exclude='.env*'    │
│    │           release/ → 服务器                                │
│    ├─ Stage 4  SSH 远程执行：                                    │
│    │           备份 DB → chown data → docker build →            │
│    │           docker compose up -d --force-recreate            │
│    └─ Stage 5  健康检查 curl http://127.0.0.1:9527/login        │
│                                                                 │
└─────────┬───────────────────────────────────────────────────────┘
          │ SSH（inkpress-service.pem）
          ▼
┌─────────────── 服务器 /opt/inkpress-service ────────────────────┐
│                                                                 │
│  ├── .env.production   chmod 600（手工填写，绝不进 git/镜像）   │
│  ├── Dockerfile.base                                              │
│  ├── docker-compose.yml                                           │
│  ├── data/inkpress-service.db   ←  部署前自动备份到 backups/     │
│  ├── backups/                                                     │
│  └── release/                   ←  rsync 目标，每次覆盖          │
│                                                                 │
│  容器启动（docker-entrypoint.sh）：                              │
│    1. prisma migrate deploy                                      │
│    2. exec node server.js (Next.js standalone, 监听 3000)        │
│                                                                 │
│  端口映射：宿主 9527 → 容器 3000                                 │
│  公网访问：http://<服务器IP>:9527  （域名 ready 后切 127.0.0.1） │
│                                                                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. 操作流程

### 2.1 首次部署（一次性）

按顺序执行三个步骤，详细命令见 `local-release-guide.md` §2-3：

| 步骤 | 命令 | 作用 |
|---|---|---|
| ① 初始化服务器 | `bash scripts/init-server.sh` | 创建目录、上传 base 配置、构建 base 镜像、生成 `.env.production` 模板 |
| ② 填写密钥 | `ssh -i inkpress-service.pem root@<IP>` 然后 `nano /opt/inkpress-service/.env.production` | 手工填入所有生产密钥（清单见 `deployment-production.md` 附录 B） |
| ③ 首次发版 | `bash scripts/release-local.sh` | 本地构建 → 推送 → 服务器构建 → 启动 → 健康检查 |

### 2.2 日常发版（一行命令）

```bash
bash scripts/release-local.sh                  # 发 latest
TAG=v1.2.3 bash scripts/release-local.sh       # 发指定 tag（同时打 latest）
```

发版前自检（可选但推荐）：

```bash
pnpm typecheck && pnpm lint
```

### 2.3 常用运维命令（本地执行）

```bash
# 实时日志
ssh -i inkpress-service.pem root@<IP> \
  'cd /opt/inkpress-service && docker compose logs -f'

# 重启 / 停止 / 启动
ssh -i inkpress-service.pem root@<IP> \
  'cd /opt/inkpress-service && docker compose restart'

# 进入容器排查
ssh -i inkpress-service.pem root@<IP> \
  'docker exec -it inkpress-service sh'
```

### 2.4 回滚

由于每次发版都重新构建，「回滚到旧版本」= `git checkout <旧commit> && bash scripts/release-local.sh`。

若涉及 schema 变更导致数据问题：
1. 立即停服（`docker compose down`）
2. 用部署前自动备份恢复 `data/inkpress-service.db`（位置：`backups/inkpress-service-<时间戳>.db`）
3. `git checkout` 到旧 commit，重新发版

详细见 `local-release-guide.md` §6。

---

## 3. 密钥管理清单（最重要）

### 3.1 绝对不能进 git 的文件

| 文件 / 模式 | 包含的敏感内容 | 忽略规则位置 |
|---|---|---|
| `.env` | 本地开发密钥（NEXTAUTH_SECRET、GITHUB_SECRET、License 私钥等） | `inkpress-service/.gitignore:19` |
| `.env.local` / `.env.*.local` | 本地覆盖 | `inkpress-service/.gitignore:20-21` |
| `.env.production` | 生产全套密钥（仅服务器存在） | `inkpress-service/.gitignore:22` + 根 `.gitignore:46` 的 `.env*` |
| `*.pem` | SSH 私钥（`inkpress-service.pem`） | `inkpress-service/.gitignore:39` |
| `*.db` / `dev.db` | SQLite 数据库（含用户、License 哈希） | `inkpress-service/.gitignore:26-28` |
| `/backups/` | DB 备份目录 | `inkpress-service/.gitignore:29` |
| `/data/` | 数据卷 | `inkpress-service/.gitignore:25` |

### 3.2 三层防泄漏保障

| 防线 | 机制 | 验证命令 |
|---|---|---|
| Git | `.gitignore` 用 `.env*` 通配符 + `*.pem` + `*.db` 覆盖所有变体 | `git check-ignore -v .env .env.production *.pem dev.db` |
| Docker | `.dockerignore` 排除 `.env*`、`*.pem`、`*.db`、`.git` | 构建上下文体积应 < 100 MB |
| 传输 | `release-local.sh` 的 rsync 显式 `--exclude='*.pem' --exclude='.env*'` | 服务器 `/opt/inkpress-service/release/` 内不应出现 `.env*` |

### 3.3 提交前自检（每次都做）

```bash
cd /Users/jielongping/OpenProjects/InkPress

# 1. 确认没有敏感文件被追踪
git ls-files | grep -E '\.(env|pem|key|p12|pfx)$|\.env\.|dev\.db'

# 2. 确认历史中也从未提交过
git log --all --full-history -- '*.env' '*.pem' '.env*' | head

# 3. 扫描待提交改动中是否含真实密钥模式
#    通用模式：长 base64 串 / 私钥头 / 已知云厂商 Key 前缀
git diff --cached --name-only | xargs grep -lE \
  '-----BEGIN [A-Z ]*PRIVATE KEY-----|LTAI[0-9A-Za-z]{12,}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}' \
  2>/dev/null

# 上述三条都应无输出（exit 0 + 空结果）。
# 若发现命中，用 git diff --cached <文件> 定位，把真实值替换为 ${VAR_NAME} 或占位符。
```

### 3.4 生产密钥的生成方式

```bash
# NEXTAUTH_SECRET / LICENSE_KEY_PEPPER / LICENSE_KEY_ENCRYPTION_SECRET / ACTIVATION_SECRET_KEK
openssl rand -base64 32

# License Token Ed25519 keypair
pnpm gen-token-key

# 二次查看密码（LICENSE_KEY_VIEW_PASSWORD）
# 自定强密码，存密码管理器
```

---

## 4. 相关文档索引

| 文档 | 内容 |
|---|---|
| `release-overview.md`（本文） | 入口总览：架构 + 流程 + 密钥管理 |
| `local-release-guide.md` | 本地发布详细指南：分层镜像原理、首次部署、日常发版、回滚、故障排查、FAQ |
| `deployment-production.md` | 生产部署方案：服务器/线路/域名选型、Caddy + HTTPS、GitHub OAuth 回调、上线验证清单 |
| `server-purchasing-guide.md` | VPS 选购指南：供应商对比、CN2 GIA/CMIN2 线路、支付宝支付 |
| `domain-and-dns-guide.md` | 域名注册与 DNS：海外注册商、TLD 选择、Cloudflare DNS 配置 |

---

## 5. 关键文件清单

```
inkpress-service/
├── Dockerfile.base               系统层镜像（一次构建）
├── Dockerfile.app                应用层镜像（每次发版）
├── docker-compose.yml            容器编排（env_file: .env.production）
├── docker-entrypoint.sh          启动入口（prisma migrate + node server.js）
├── .dockerignore                 排除 .env*、*.pem、*.db
├── .env.example                  环境变量模板（无真实值，可进 git）
├── .env                          本地真实密钥（gitignored）
├── .gitignore                    忽略规则
├── inkpress-service.pem          SSH 私钥（gitignored）
├── scripts/
│   ├── init-server.sh            服务器首次初始化
│   ├── release-local.sh          本地发布主入口（5 阶段）
│   ├── gen-token-key.ts          生成 Ed25519 密钥对
│   ├── init-admin.ts             幂等初始化管理员
│   └── backup-db.ts              SQLite 在线备份
└── docs/
    ├── release-overview.md       ← 本文
    ├── local-release-guide.md
    ├── deployment-production.md
    ├── server-purchasing-guide.md
    └── domain-and-dns-guide.md
```
