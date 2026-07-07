# 本地发布指南（base + app 分层，本地编译 + 服务器构建）

> 适用场景：**没有 CI/CD**，开发者本地编译 → 推送 → 服务器构建 → 拉起容器。
>
> 后续接入 GitHub Actions 时，可平滑切换到 `cicd-guide.md` 的方案。

---

## 0. 架构与流程

```
┌─────────────── 开发者 Mac ───────────────┐
│                                          │
│  pnpm install                            │
│  pnpm exec prisma generate               │
│  pnpm build                              │
│       │                                  │
│       ▼                                  │
│  release/                                │
│    ├── .next/standalone  (Next 产物)     │
│    ├── .next/static                      │
│    ├── src/generated    (Prisma Client)  │
│    ├── prisma/          (schema+migrations)│
│    ├── package.json + pnpm-lock          │
│    ├── docker-entrypoint.sh              │
│    └── Dockerfile     (= Dockerfile.app) │
│       │                                  │
│       │ rsync -az --delete               │
│       ▼                                  │
└─────────┼────────────────────────────────┘
          │ SSH (key auth)
          ▼
┌──────────── 阿里云香港服务器 ────────────┐
│                                          │
│  /opt/inkpress-service/                  │
│    ├── docker-compose.yml                │
│    ├── .env.production                   │
│    ├── Dockerfile.base                   │
│    ├── data/              (SQLite)       │
│    ├── backups/           (部署前备份)   │
│    └── release/          (本地产物)      │
│                                          │
│  docker build -t inkpress-service:latest │
│      ./release                           │
│       │                                  │
│       │ 基础镜像 inkpress-service-base   │
│       │ (一次性构建，长期缓存)           │
│       ▼                                  │
│  docker compose up -d --force-recreate   │
│                                          │
└──────────────────────────────────────────┘
```

---

## 1. 分层镜像策略

### base 镜像（`inkpress-service-base:latest`）

**包含**：Node 22 + openssl + 构建工具 + pnpm + 用户/目录
**不包含**：任何应用代码

**重建时机**：
- 首次部署（必须）
- `Dockerfile.base` 变更（升级 Node 版本、增减系统包）
- 大版本升级（一般半年一次）

**体积**：~400 MB（一次构建长期复用）

### app 镜像（`inkpress-service:latest`）

**包含**：base + node_modules（仅原生模块 + Prisma） + Next 产物 + Prisma schema

**重建时机**：每次发版

**体积**：~600 MB（其中 base 层复用，实际新增 ~200 MB）

### 缓存策略

| 文件变化 | 缓存命中 | 实际重建时间 |
|---------|---------|------------|
| 仅改业务代码（`.next/*`） | runner 阶段全部命中 | ~10 秒 |
| 改 `package.json`/lockfile | runner 命中，deps 失效 | ~30 秒（pnpm install 增量） |
| 改 `Dockerfile.base` | 全部失效 | ~3-5 分钟（罕见） |

---

## 2. 一次性配置

### 2.1 修改脚本里的服务器配置

编辑 `scripts/init-server.sh` 和 `scripts/release-local.sh` 顶部的配置块：

```bash
SSH_KEY="./inkpress-service.pem"            # 你的密钥路径
SSH_HOST="root@<你的阿里云公网IP>"            # 例: root@203.0.113.10
SSH_PORT="22"                                # 阿里云默认 22
REMOTE_DIR="/opt/inkpress-service"           # 服务器部署路径
```

或者通过环境变量覆盖，避免修改脚本：

```bash
export SSH_HOST=root@203.0.113.10
export SSH_KEY=~/keys/aliyun.pem
```

### 2.2 确保 SSH key 权限

```bash
chmod 600 inkpress-service.pem
# 否则 ssh 会拒绝使用，报 "Permissions are too open"
```

### 2.3 测试 SSH 连通

```bash
ssh -i inkpress-service.pem root@<你的IP>
# 阿里云密钥登录默认开启，应该秒连
```

### 2.4 阿里云控制台放行端口

阿里云轻量服务器 → 实例详情 → **防火墙** → 添加规则：

| 应用类型 | 协议 | 端口范围 | 来源 |
|---------|------|---------|------|
| 自定义 TCP | TCP | 9527 | 0.0.0.0/0 |
| HTTP | TCP | 80 | 0.0.0.0/0（后续 Caddy 用） |
| HTTPS | TCP | 443 | 0.0.0.0/0（后续 Caddy 用） |

> 必须放行 **9527** 才能通过 IP 访问，否则浏览器连不上。

---

## 3. 首次部署（约 5-10 分钟）

### Step 1：初始化服务器

```bash
cd /Users/jielongping/OpenProjects/InkPress/inkpress-service
bash scripts/init-server.sh
```

脚本自动完成：
1. 测试 SSH 连通
2. 创建 `/opt/inkpress-service` 目录结构
3. 上传 `Dockerfile.base` / `docker-compose.yml` / `.env.example`
4. **构建 base 镜像**（约 3-5 分钟，仅首次）
5. 生成 `.env.production` 模板

### Step 2：填写 `.env.production`

```bash
ssh -i inkpress-service.pem root@<IP>
cd /opt/inkpress-service
nano .env.production
```

必填项（按 `deployment-production.md` §5.3 详述）：

```dotenv
# 必填：32 字节随机串（生成命令：openssl rand -base64 32）
NEXTAUTH_SECRET="<生成>"
NEXTAUTH_URL="http://<服务器IP>:9527"     # 临时 IP 访问，后续换域名
SECURE_COOKIES=false                       # 临时 HTTP，绑域名后改 true

# 必填：License 相关密钥
LICENSE_KEY_PEPPER="<openssl rand -base64 32>"
LICENSE_KEY_VIEW_PASSWORD="<自定强密码>"
LICENSE_KEY_ENCRYPTION_SECRET="<openssl rand -base64 32>"
ACTIVATION_SECRET_KEK="<openssl rand -base64 32>"

# 必填：Ed25519 签名密钥（本地 pnpm gen-token-key 生成）
LICENSE_TOKEN_PRIVATE_KEY="<私钥>"
LICENSE_TOKEN_PUBLIC_KEY="<公钥>"

# 管理员初始化（仅无 ADMIN 时生效）
ADMIN_EMAIL="your@email.com"
ADMIN_PASSWORD="<临时强密码，首登改>"

# 邮件（开发期可暂用 console）
MAIL_PROVIDER="console"
MAIL_FROM="InkPress <noreply@localhost>"
```

保存后 `chmod 600 .env.production`（init 脚本已经做过，保留即可）。

### Step 3：执行首次发布

```bash
# 本地
bash scripts/release-local.sh
```

脚本流程：
1. 本地 `pnpm install` + `prisma generate` + `pnpm build`
2. 打包 `release/`
3. rsync 推送到服务器
4. 服务器 `docker build` + `docker compose up`
5. 健康检查（最长 60 秒）

成功输出：
```
==========================================
  发布完成!
==========================================
  访问: http://203.0.113.10:9527/login
```

### Step 4：浏览器验证

打开 `http://<服务器IP>:9527/login`：
- 登录页正常显示
- 用 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录成功
- 首登强制改密流程正常

---

## 4. 日常发版（一行命令）

```bash
bash scripts/release-local.sh
```

每次发版实际耗时：
- 本地 build：~30 秒（增量）
- rsync 推送：~10 秒（产物约 30-50 MB）
- 服务器 build：~30 秒（缓存命中）
- 重启 + 健康检查：~10 秒
- **总计：约 1-2 分钟**

### 发版前自检（可选但推荐）

```bash
pnpm typecheck   # 类型检查
pnpm lint        # ESLint
```

---

## 5. 常用运维命令

所有命令在本地执行：

```bash
# 查看日志（实时）
ssh -i inkpress-service.pem root@<IP> \
  'cd /opt/inkpress-service && docker compose logs -f'

# 重启容器
ssh -i inkpress-service.pem root@<IP> \
  'cd /opt/inkpress-service && docker compose restart'

# 停止 / 启动
ssh -i inkpress-service.pem root@<IP> \
  'cd /opt/inkpress-service && docker compose down'
ssh -i inkpress-service.pem root@<IP> \
  'cd /opt/inkpress-service && docker compose up -d'

# 进入容器
ssh -i inkpress-service.pem root@<IP> \
  'docker exec -it inkpress-service sh'

# 查看容器状态
ssh -i inkpress-service.pem root@<IP> \
  'cd /opt/inkpress-service && docker compose ps'

# 查看数据卷大小
ssh -i inkpress-service.pem root@<IP> \
  'du -sh /opt/inkpress-service/data'
```

---

## 6. 回滚

### 6.1 快速回滚到旧镜像（推荐）

每次构建都会产生新镜像。如果新版本有问题，回滚到之前的镜像：

```bash
# 服务器侧查看镜像历史
ssh -i inkpress-service.pem root@<IP> \
  'docker images inkpress-service --format "{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}"'
```

但要先用 `TAG=xxx` 发版过才会有非 latest 的 tag。所以发版建议：

```bash
# 每次发版都打一个语义化 tag
TAG=v1.2.3 bash scripts/release-local.sh
# 这会同时给镜像打 inkpress-service:v1.2.3 和 inkpress-service:latest

# 紧急回滚到 v1.2.2
TAG=v1.2.2 bash scripts/release-local.sh
# 但 v1.2.2 的 release/ 产物已经被覆盖，需要重新跑 build...
```

⚠️ **当前脚本设计**：每次都重新构建，所以"回滚到旧版本"= `git checkout v1.2.2 && bash scripts/release-local.sh`。

### 6.2 数据库回滚（重要！）

Prisma migrate deploy 是**单向**的，新 migration 部署后无法自动回滚。如果发版包含 schema 变更导致数据问题：

```bash
# 1. 立即停服
ssh -i inkpress-service.pem root@<IP> \
  'cd /opt/inkpress-service && docker compose down'

# 2. 恢复部署前备份
ssh -i inkpress-service.pem root@<IP> '
  cd /opt/inkpress-service
  cp backups/inkpress-service-<最新时间戳>.db data/inkpress-service.db
'

# 3. git checkout 到旧版本，重新发版
git checkout <旧commit>
bash scripts/release-local.sh
```

---

## 7. 后续切换到域名 + HTTPS

当域名 ready，切换到 Caddy 反代 + HTTPS：

### Step 1：修改 `docker-compose.yml`

```yaml
    ports:
      - "127.0.0.1:9527:3000"   # 改回只绑回环
```

### Step 2：修改 `.env.production`

```dotenv
NEXTAUTH_URL="https://inkpress.example.com"
SECURE_COOKIES=true
```

### Step 3：服务器安装 Caddy 并配置

见 `deployment-production.md` §4.6 + §6。

### Step 4：阿里云防火墙

保留 80/443，**移除 9527**（不再需要公网访问）。

### Step 5：发版

```bash
bash scripts/release-local.sh
```

---

## 8. 故障排查

### 8.1 本地构建失败

| 错误 | 原因 | 处理 |
|------|------|------|
| `pnpm install` 卡住 | npm registry 限流 | `npm config set registry https://registry.npmmirror.com` |
| `prisma generate` 失败 | schema 语法错误 | 检查最近 `schema.prisma` 改动 |
| `next build` OOM | Mac 内存不够 | 关闭其他应用；或 `NODE_OPTIONS=--max-old-space-size=4096 pnpm build` |
| `.next/standalone` 不存在 | `next.config.ts` 未启用 standalone | 确认 `output: "standalone"` |

### 8.2 推送/部署失败

| 错误 | 原因 | 处理 |
|------|------|------|
| `Permission denied (publickey)` | SSH key 不匹配 | 检查 `chmod 600 inkpress-service.pem` |
| `rsync: connection unexpectedly closed` | 网络抖动 | 重试，或 `--partial --append-verify` |
| 阿里云 `port 9527 unreachable` | 防火墙未放行 | 阿里云控制台 → 防火墙 → 添加 TCP 9527 |
| `docker build` 慢 | npm registry 慢 | base 镜像已配 npmmirror，应该不慢；如仍慢，检查 Docker DNS |
| `docker compose up` 报 `image not found` | 镜像构建失败 | `docker images` 看 `inkpress-service:latest` 是否存在 |

### 8.3 应用启动失败

容器跑起来但 `/login` 5xx：

```bash
ssh -i inkpress-service.pem root@<IP> \
  'cd /opt/inkpress-service && docker compose logs --tail=200'
```

常见错误：

| 日志 | 原因 | 处理 |
|------|------|------|
| `prisma migrate deploy` 失败 | schema 不兼容 / 数据损坏 | 恢复 backups/ 最新一份 |
| `better-sqlite3 ... Error: ... .node` | 原生模块平台不匹配 | 服务器侧重新 build（不能复用 Mac 的） |
| `EACCES: permission denied, /data/...` | data 目录所有者错误 | `sudo chown -R 1001:1001 /opt/inkpress-service/data`（容器内 nextjs UID 通常 1001） |
| `NEXTAUTH_SECRET is missing` | .env.production 未填 | 编辑 `.env.production` 填好 |
| 端口被占用 | 9527 被其他进程占用 | `lsof -i :9527` 找占用者 |

### 8.4 健康检查超时但容器其实正常

```bash
# 1. 看容器状态
ssh -i inkpress-service.pem root@<IP> 'docker ps | grep inkpress'

# 2. 看容器是否在监听
ssh -i inkpress-service.pem root@<IP> 'curl -v http://127.0.0.1:9527/login'

# 3. 看日志
ssh -i inkpress-service.pem root@<IP> \
  'cd /opt/inkpress-service && docker compose logs --tail=80'
```

---

## 9. 文件清单

新增/修改的文件：

```
inkpress-service/
├── Dockerfile                  # CI/CD 模式（保留，后续接入 GitHub Actions 时用）
├── Dockerfile.base             🆕 base 镜像构建（系统层）
├── Dockerfile.app              🆕 app 镜像构建（基于 base + 本地产物）
├── docker-compose.yml          ✏️ 切换为本地构建模式 + 公网端口
├── docker-entrypoint.sh        ✏️ 启动前先跑 prisma migrate deploy
├── scripts/
│   ├── init-server.sh          🆕 服务器首次初始化
│   ├── release-local.sh        🆕 本地发布主入口
│   └── deploy.sh               # CI/CD 服务器侧 fallback（保留）
└── docs/
    └── local-release-guide.md  🆕 本文档
```

---

## 10. FAQ

### Q1：为什么不直接用 `docker save | scp | docker load`？

**A**：Mac 上 docker build 出的镜像虽然跑在 Linux VM 里，但：
1. better-sqlite3 / argon2 等原生模块可能因 glibc 版本差异在阿里云内核上跑不起来
2. Mac Docker 镜像体积更大（含 build 依赖）
3. 服务器构建能利用 Docker 缓存（package.json 不变秒级完成）

**服务器侧 docker build 才是最稳的方式**。

### Q2：base 镜像什么时候要重建？

**A**：以下情况需要重建（在服务器上跑）：

```bash
ssh -i inkpress-service.pem root@<IP> '
  cd /opt/inkpress-service
  # 上传新的 Dockerfile.base 后：
  docker build -f Dockerfile.base -t inkpress-service-base:latest .
'
```

触发场景：
- Node 升级（如 22 → 24）
- 新增系统依赖（如 `imagemagick`）
- 优化 apt/npm 镜像源
- Debian 升级（如 bookworm → trixie）

### Q3：怎么知道发版后哪些镜像 tag 在服务器？

```bash
ssh -i inkpress-service.pem root@<IP> \
  'docker images inkpress-service --format "{{.Tag}}\t{{.CreatedAt}}"'
```

### Q4：能不能让 release-local.sh 不重新 build？

**A**：可以。编辑脚本，把 Stage 1（本地构建）和 Stage 2（准备 release）放到条件判断里：

```bash
SKIP_BUILD=1 bash scripts/release-local.sh
```

但需要在脚本里加：
```bash
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  # ... pnpm install + build
fi
```

适合"只改了配置/静态文件，没动业务代码"的场景。

### Q5：后续接 CI/CD 麻烦吗？

**A**：不麻烦。本地发布与 CI/CD 完全解耦：

- `Dockerfile`（CI/CD 用，单文件 4 阶段）和 `Dockerfile.app` + `Dockerfile.base`（本地用，分层）共存
- `scripts/release-local.sh`（本地用）和 `.github/workflows/inkpress-service.yml`（CI/CD 用）共存
- 切换时只需在 `docker-compose.yml` 里把 `image: inkpress-service:latest` 改为 `image: ghcr.io/ccweixiao/inkpress-service:latest`

详见 `cicd-guide.md`。

### Q6：能不能本地直接 docker build 推镜像，省服务器构建？

**A**：技术上可以（Mac 上 docker build --platform linux/amd64），但**不推荐**：

1. Mac 上跨平台 build 慢（QEMU 模拟）
2. 原生模块（better-sqlite3）编译可能失败
3. 镜像传输 ~300MB 比 rsync 产物 ~50MB 慢得多
4. 失去服务器侧 Docker 缓存优势

服务器侧 docker build 是性价比最高的方案。

---

## 11. 速查命令

```bash
# === 首次部署 ===
bash scripts/init-server.sh                          # 初始化服务器 + 构建 base
ssh -i inkpress-service.pem root@<IP>                # 登录填 .env.production
bash scripts/release-local.sh                        # 首次发版

# === 日常发版 ===
bash scripts/release-local.sh                        # 发 latest
TAG=v1.0.0 bash scripts/release-local.sh             # 发指定 tag

# === 运维 ===
ssh -i inkpress-service.pem root@<IP> 'cd /opt/inkpress-service && docker compose logs -f'
ssh -i inkpress-service.pem root@<IP> 'cd /opt/inkpress-service && docker compose restart'

# === 阿里云控制台 ===
# 防火墙规则 → 添加 TCP 9527 / 80 / 443
```

---

## 附录：脚本执行流程详解

### `init-server.sh` 流程

```
本地 ──SSH──> 服务器
              │
              ├── 创建 /opt/inkpress-service/{data,backups,release}
              │
              ├── 上传 Dockerfile.base / docker-compose.yml / .env.example
              │
              ├── docker build -f Dockerfile.base -t inkpress-service-base:latest .
              │   （首次 ~3-5 分钟；后续跳过）
              │
              └── cp .env.example .env.production
                  （等用户登录编辑）
```

### `release-local.sh` 流程

```
本地：
  pnpm install --frozen-lockfile
  pnpm exec prisma generate
  pnpm build                           # 生成 .next/standalone
  cp 产物到 release/
  rsync release/ → 服务器

服务器（通过 SSH 远程执行）：
  cd /opt/inkpress-service
  cp data/inkpress-service.db backups/...
  cd release
  docker build -t inkpress-service:latest .   # 基于 base 镜像
  cd ..
  docker compose up -d --force-recreate       # 重启容器
  docker image prune -f

本地：
  健康检查 curl http://<IP>:9527/login
  报告结果
```
