# InkPress Service 生产部署方案

> 目标：**国内免备案稳定访问** + 全链路 HTTPS + 一键可重复部署。
>
> 适用范围：`inkpress-service`（用户 / 认证 / License 服务）。InkPress 主应用不在本文档范围。

---

## 0. 方案选型对比

「不备案 + 国内能稳定访问」本质是要解决两件事：

1. **80/443 不被运营商拦截** —— 国内服务器绑定未备案域名时，运营商会在 80/443 上做阻断。
2. **线路质量** —— 直连海外普通线路在晚高峰丢包严重，影响 License 验证这种**短连接、低延迟敏感**的接口。

| 方案 | 备案 | 国内稳定性 | 成本 | 备注 |
|------|------|-----------|------|------|
| A. 国内云 + 国内节点 + 域名备案 | 必须 | 极佳 | 中 | 不符合「不想备案」前提，**排除** |
| B. 国内云的**海外节点**（阿里云香港/腾讯云硅谷） | 不需要 | 良好 | 中高 | 阿里云/腾讯云的「海外轻量」可选，但运营商白名单限制较少 |
| C. **海外 VPS + CN2 GIA / CMIN2 优化线路** | 不需要 | 优秀 | 中 | 推荐：搬瓦工 CN2 GIA、BandwagonHost、DogYun、HostDare 等 |
| D. 海外普通 VPS + Cloudflare 套 CDN | 不需要 | 中等 | 低 | CF 在国内部分运营商被限速/抖动；适合兜底而非首选 |
| E. 海外普通 VPS 直连 | 不需要 | 差（晚高峰） | 低 | 不推荐 |

**本文档推荐方案 C**：

```
[ 国内用户 ] --(优化线路)--> [ 海外 VPS (CN2 GIA) ]
                                   |
                                   +-- Caddy / Nginx (TLS 443, 反向代理)
                                   +-- Docker (inkpress-service:3000)
                                   +-- SQLite (/data/inkpress-service.db)
```

如预算紧或临时验证，可先用方案 D（CF 橙云）兜底，但要做好 CF 节点抖动的心理预期。

---

## 1. 服务器选购建议

### 1.1 配置要求

InkPress Service 单机内存占用约 **200–400 MB**（含 Prisma + SQLite + pino）。建议：

| 项目 | 最低 | 推荐 |
|------|------|------|
| CPU | 1 核 | 2 核 |
| 内存 | 1 GB | 2 GB |
| 磁盘 | 10 GB SSD | 20 GB SSD |
| 带宽 | 100 Mbps 共享 | 200 Mbps+ 或按流量计费 |
| 系统 | Debian 12 / Ubuntu 22.04 | Debian 12 |

### 1.2 推荐供应商（按优化线路排序）

| 供应商 | 推荐套餐 | 线路 | 备注 |
|--------|---------|------|------|
| **搬瓦工 BandwagonHost** | CN2 GIA-E 年付方案 | **CN2 GIA**（电信回程优化） | 国内晚高峰表现最稳，支持支付宝 |
| **DogYun** | 香港云服务器（CMIN2） | **移动 CMIN2** | 移动用户极佳；电信联通一般 |
| **HostDare** | CKV / SCNV 套餐 | CN2 GIA | 性价比高，偶有缺货 |
| **阿里云轻量海外** | 香港 / 新加坡 | 普通国际线路 | 稳定但晚高峰可能不如 CN2 GIA |
| **腾讯云轻量海外** | 硅谷 / 首尔 | 普通国际线路 | 同上 |
| **Vultr / DigitalOcean** | 东京 / 新加坡 / 首尔 | **普通国际** | 国内访问抖动明显，不推荐做主用 |

> 选择线路时优先匹配你的主要用户运营商。电信用户多 → CN2 GIA；移动用户多 → CMIN2；联通 → 一般国际也能接受。

### 1.3 购买后立刻做的事

1. 记下服务器公网 IP（如 `203.0.113.10`）
2. 在控制台**放行端口**：仅放 `22`（SSH，建议改非默认端口）/ `80` / `443`；不要放 `9527` 到公网
3. 关闭供应商提供的「防火墙默认全开」选项

---

## 2. 域名注册

### 2.1 注册商选择

未备案前提下，**强烈建议使用海外注册商**，避免后续转移与实名审核麻烦：

| 注册商 | 优势 | 支付方式 |
|--------|------|---------|
| **Cloudflare Registrar** | 零加价、自带 DNS、API 强 | 信用卡 / PayPal |
| **Porkbun** | 价格低、免费隐私保护 | 信用卡 / PayPal |
| **Namecheap** | 老牌、首年便宜 | 信用卡 / PayPal |
| **GoDaddy** | 续费贵、不推荐 | 多种 |

> 不推荐在国内注册商（万网、新网）注册 —— 即使不备案，注册过程中可能要求实名认证，且 `.com` 等实名后转移到海外也要几天。

### 2.2 TLD 选择

| 优先级 | TLD | 说明 |
|-------|-----|------|
| 推荐 | `.com` | 通用、最稳、不会被特殊处理 |
| 可选 | `.io` `.app` `.dev` `.ai` | `.app` / `.dev` **强制 HTTPS**（HSTS preload），与本项目正好契合 |
| 避免 | `.top` `.xyz` `.icu` `.click` 等廉价 TLD | 部分被国内 DNS 污染 / 标记为可疑 |

### 2.3 域名规划示例

```
example.com                 主域（不直接提供服务）
inkpress.example.com        InkPress Service（本服务）
press.example.com           InkPress 主应用（如有）
```

本文档后续以 `inkpress.example.com` 为示例，请按需替换。

---

## 3. DNS 解析配置

### 3.1 DNS 托管商选择

| 托管商 | 国内解析速度 | 备注 |
|--------|------------|------|
| **Cloudflare DNS** | 良好 | 免费、API 强、自带 SSL；**只做 DNS（灰云）即可**，不必开橙云代理 |
| **DNSPod 国际版** | 优秀 | 腾讯系，国内访问快 |
| **阿里云 DNS（独立于服务器）** | 优秀 | 需要域名实名（即使不备案）；不推荐与「免备案」诉求混用 |

> 推荐方案：**Cloudflare DNS（仅解析，不开代理）**。优势：免费 + 抗攻击 + 可随时切到橙云做兜底。

### 3.2 配置步骤（以 Cloudflare DNS 为例）

1. 在 Cloudflare 控制台添加你的域名
2. 在域名注册商处把 **Nameservers** 改为 Cloudflare 提供的两个 NS（如 `xxx.ns.cloudflare.com`）
3. 等待 NS 生效（10 分钟 – 24 小时），用以下命令验证：
   ```bash
   dig NS example.com +short
   ```
4. 在 Cloudflare DNS 面板添加 A 记录：

   | Type | Name | Content | Proxy Status | TTL |
   |------|------|---------|--------------|-----|
   | `A` | `inkpress` | `203.0.113.10`（服务器 IP） | **DNS only**（灰云） | Auto |

   > **不要开橙云代理**：Cloudflare 免费版反向代理不支持非常规端口、且在国内访问 CF 节点本身有抖动。要做兜底再加。

### 3.3 验证解析

```bash
dig inkpress.example.com +short
# 应返回 203.0.113.10
```

国内不同运营商验证（用阿里云在线 dig /站长工具 ping）：
- 电信 / 联通 / 移动 各地解析应一致指向同一 IP

---

## 4. 服务器初始化

### 4.1 首次登录 + 基础加固

```bash
# 本地
ssh root@203.0.113.10

# 服务器上执行
apt update && apt -y upgrade
apt -y install curl ca-certificates ufw fail2ban
timedatectl set-timezone Asia/Shanghai
```

### 4.2 创建部署用户（避免 root 直跑）

```bash
adduser --gecos "" inkpress
usermod -aG sudo inkpress
mkdir -p /home/inkpress/.ssh
cp /root/.ssh/authorized_keys /home/inkpress/.ssh/
chown -R inkpress:inkpress /home/inkpress/.ssh
chmod 700 /home/inkpress/.ssh
chmod 600 /home/inkpress/.ssh/authorized_keys
```

### 4.3 SSH 加固

编辑 `/etc/ssh/sshd_config`：

```
Port 22022                           # 改为非 22
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

重启：

```bash
systemctl restart sshd
```

> 之后用 `ssh -p 22022 inkpress@203.0.113.10` 登录。

### 4.4 防火墙（ufw）

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22022/tcp comment 'SSH'
ufw allow 80/tcp   comment 'HTTP'
ufw allow 443/tcp  comment 'HTTPS'
ufw enable
```

> **不要** `ufw allow 9527` —— 容器只通过反向代理对外暴露。

### 4.5 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker inkpress
# 重新登录使组生效
```

### 4.6 安装 Caddy（反向代理 + 自动 HTTPS）

```bash
apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt -y install caddy
```

---

## 5. 部署 InkPress Service

### 5.1 拉取代码

```bash
sudo -iu inkpress
cd ~
git clone <你的仓库地址> inkpress-service-repo
cd inkpress-service-repo/inkpress-service
```

> 如果仓库是私有的，用 SSH key 或 GitHub Deploy Key。

### 5.2 生成生产密钥

一次性生成所有需要的密钥：

```bash
# NEXTAUTH_SECRET / LICENSE_KEY_PEPPER / LICENSE_KEY_ENCRYPTION_SECRET / ACTIVATION_SECRET_KEK
for i in 1 2 3 4; do openssl rand -base64 32; done

# License Token Ed25519 keypair
pnpm gen-token-key   # 在能跑 pnpm 的环境；或本地生成后复制
```

把输出**妥善保管到一个密码管理器**，下一步要填入 `.env.production`。

### 5.3 配置 `.env.production`

```bash
cp .env.example .env.production
```

编辑 `.env.production`，按以下关键项填写（其他保持默认或按需调）：

```dotenv
# ===== 数据库 =====
DATABASE_URL="file:/data/inkpress-service.db"

# ===== NextAuth =====
NEXTAUTH_SECRET="<上面 openssl 第一行>"
NEXTAUTH_URL="https://inkpress.example.com"
SECURE_COOKIES=true

# ===== GitHub OAuth（见 §6 重新申请）=====
GITHUB_ID=""
GITHUB_SECRET=""
NEXT_PUBLIC_GITHUB_ENABLED="1"      # 注意：即便 ID/SECRET 暂留空也可设 1；但若要真正可用必须填上

# ===== License =====
LICENSE_KEY_PEPPER="<openssl 第二行>"
LICENSE_KEY_VIEW_PASSWORD="<自定强密码>"
LICENSE_KEY_ENCRYPTION_SECRET="<openssl 第三行>"
ACTIVATION_SECRET_KEK="<openssl 第四行>"
LICENSE_TOKEN_PRIVATE_KEY="<gen-token-key 输出的私钥>"
LICENSE_TOKEN_PUBLIC_KEY="<gen-token-key 输出的公钥>"

# ===== 邮件（生产推荐 resend 或 smtp）=====
MAIL_PROVIDER="resend"              # 或 smtp
MAIL_FROM="InkPress <noreply@inkpress.example.com>"
RESEND_API_KEY="<你的 resend key>"
# 或 SMTP_*

# ===== 管理员初始化（仅无 ADMIN 时生效）=====
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="<临时强密码，首登强制改>"

# ===== 日志 / 安全（默认值即可）=====
LOG_LEVEL="info"
SECURITY_HEADERS_ENABLE="true"
```

权限收紧：

```bash
chmod 600 .env.production
```

### 5.4 修改 docker-compose 端口绑定（关键）

仓库默认 `docker-compose.yml` 把 `9527` 暴露到宿主机所有网卡。生产环境**只允许反向代理访问**，因此改为只监听本机回环：

编辑 `docker-compose.yml`，把

```yaml
    ports:
      - "9527:3000"
```

改为

```yaml
    ports:
      - "127.0.0.1:9527:3000"
```

> 这样 `9527` 仅本机可访问；Caddy 通过 `127.0.0.1:9527` 反代到公网 `443`。

### 5.5 一键部署

```bash
bash scripts/deploy.sh
```

脚本会：备份 DB → 构建镜像 → 启动容器 → 健康检查 → 初始化管理员。

部署后验证：

```bash
# 容器状态
docker compose ps

# 本机直连应用（不经过反代）
curl -I http://127.0.0.1:9527/login

# 查看日志
docker compose logs -f
```

---

## 6. 配置反向代理 + HTTPS

### 6.1 Caddyfile

编辑 `/etc/caddy/Caddyfile`：

```caddyfile
inkpress.example.com {
    encode zstd gzip

    # 反向代理到本地容器
    reverse_proxy 127.0.0.1:9527 {
        # 透传真实客户端信息（next.config 与日志需要）
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # 安全头（next.config 已下发大部分，这里做兜底）
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        Referrer-Policy strict-origin-when-cross-origin
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
    }

    # 静态资源缓存（可选）
    @static path /_next/static/*
    header @static Cache-Control "public, max-age=31536000, immutable"

    log {
        output file /var/log/caddy/inkpress.log {
            roll_size 100mb
            roll_keep 10
        }
        format console
    }
}
```

启动 / 重载：

```bash
systemctl enable --now caddy
caddy reload --config /etc/caddy/Caddyfile
```

Caddy 会**自动向 Let's Encrypt 申请证书**（首次启动即完成）。如果失败，检查：

- 80 / 443 在 ufw 已放行
- 域名 A 记录已正确解析到本机
- 服务器厂商控制台防火墙也放行了 80 / 443（如阿里云轻量有独立的「防火墙规则」）

### 6.2 验证 HTTPS

```bash
curl -I https://inkpress.example.com/login
# 期望：HTTP/2 200，响应头含 strict-transport-security
```

浏览器访问 `https://inkpress.example.com/login`，确认：
- 锁标志正常（无证书警告）
- GitHub 登录按钮显示（`NEXT_PUBLIC_GITHUB_ENABLED=1` 生效）
- 控制台无 CSP 报错

### 6.3 HSTS Preload（可选，谨慎）

稳定运行 1–2 周后，可申请加入 [HSTS Preload List](https://hstspreload.org/)：
- 需 `includeSubDomains` 且 `max-age ≥ 31536000`
- **不可逆**（加入后无法快速撤回），确认不再需要 HTTP 回退后再申请

---

## 7. 重新配置 GitHub OAuth 回调

本地开发用的 OAuth App 在生产**不能复用**，需新建一个：

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**

   ```
   Application name:           InkPress Service (Production)
   Homepage URL:               https://inkpress.example.com
   Authorization callback URL: https://inkpress.example.com/api/auth/callback/github
   ```

2. 生成 Client Secret，立即复制（只显示一次）

3. 把 `GITHUB_ID` / `GITHUB_SECRET` 填回服务器 `.env.production`

4. 重启容器使配置生效：

   ```bash
   docker compose up -d --force-recreate
   ```

> 提醒：`NEXT_PUBLIC_GITHUB_ENABLED` 已在构建期注入到客户端 bundle。修改 `.env.production` 后**必须** `docker compose build` 重新构建镜像，仅重启容器对客户端代码无效。

---

## 8. 上线后验证清单

依次确认以下项目：

- [ ] `https://inkpress.example.com/login` 可访问，证书有效
- [ ] 邮箱密码登录正常（用初始化的 `ADMIN_EMAIL` / `ADMIN_PASSWORD`）
- [ ] 首登强制改密流程正常
- [ ] GitHub 登录跳转 / 回调 / 落库正常（库内 `User.emailVerified` 不为 null）
- [ ] `/api/v1/licenses/activate` 公网可达（curl 一下 401/422 都算可达）
- [ ] ufw 状态：`ufw status` 仅 22022 / 80 / 443
- [ ] `curl http://inkpress.example.com` 会被 Caddy 强制 301 → HTTPS
- [ ] 不同运营商（电信/联通/移动）ping 延迟在可接受范围（一般 < 150ms 即可）

---

## 9. 运维与备份

### 9.1 日常命令

```bash
cd ~/inkpress-service-repo/inkpress-service

bash scripts/deploy.sh         # 重新部署（自动备份 DB）
docker compose logs -f         # 实时日志
docker compose restart         # 重启
docker compose down            # 停止
```

### 9.2 自动备份（cron）

```bash
crontab -e
```

加入：

```
0 3 * * * cd /home/inkpress/inkpress-service-repo/inkpress-service && docker compose exec -T inkpress-service node -e "require('/app/node_modules/better-sqlite3')('/data/inkpress-service.db').backup('/data/backup-$(date +\%F).db')" && cp data/backup-*.db backups/ 2>/dev/null || true
```

更推荐：每日把 `./data/inkpress-service.db` 异步上传到对象存储（S3 / R2 / OSS 海外节点）。

### 9.3 证书续期

Caddy 自动续期，无需 cron。如要查看到期时间：

```bash
curl -vI https://inkpress.example.com 2>&1 | grep -i expire
```

---

## 10. 故障排查

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| 浏览器访问被拦、显示「无法访问」 | 域名未解析 / 防火墙未放行 / 服务商处另有安全组 | `dig` 检查解析；`ufw status`；查云厂商控制台安全组 |
| 证书申请失败（Caddy 日志 timeout） | 80 端口未通到 Let's Encrypt 验证服务器 | 检查 ufw + 云厂商安全组都放行 80 |
| GitHub 登录报 `Configuration` | `GITHUB_ID/SECRET` 没填或 OAuth App 回调 URL 不一致 | 重新核对回调 URL 必须是 `https://<域名>/api/auth/callback/github` |
| GitHub 登录报 `OAuthCallback` 且 `auth.ts` 日志 `GitHub verified email 查询失败` | 用户邮箱在 GitHub 未验证 | 提示用户先在 GitHub 验证邮箱 |
| 国内访问慢、丢包 | 线路问题，非应用层 | 切换 CN2 GIA / CMIN2 套餐；或临时开 Cloudflare 橙云兜底 |
| 容器健康检查失败 | 多半是 `prisma migrate deploy` 失败 | `docker compose logs --tail=200` 看 migrate 错误；通常是 DATABASE_URL 路径权限问题 |
| 修改 env 后客户端未生效 | `NEXT_PUBLIC_*` 是构建期注入 | `docker compose build && docker compose up -d --force-recreate` |

---

## 11. 进阶（可选）

### 11.1 Cloudflare 橙云兜底

当 VPS 线路在晚高峰不稳时，临时切到 Cloudflare 代理：

1. Cloudflare DNS 面板把该 A 记录从 **DNS only（灰云）** 切为 **Proxied（橙云）**
2. Caddy 改用 Cloudflare 的 [Origin CA 证书](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/) 而非 Let's Encrypt
3. 启用 CF 的「Authenticated Origin Pulls」防止有人绕过 CF 直连源站

> 注意：CF 免费版会限制一些路径（如非标端口、WebSocket 长连），本项目纯 HTTP 接口不受影响。

### 11.2 多实例与 Redis 化

当前单机内存版限流 / 风控在多实例下会失真。如未来需要水平扩展：

- 数据库迁出 SQLite → PostgreSQL
- 限流 / 风控 / nonce 防重放迁到 Redis
- 见 PDC §9.3 后续演进

### 11.3 监控

最小化方案：

- UptimeRobot（免费）轮询 `https://inkpress.example.com/api/health`（如未实现可加一个轻量端点）
- 服务器装 `netdata` 或 `node_exporter` + Prometheus

---

## 附录 A：完整部署命令速查

```bash
# === 一次性：服务器初始化（root）===
apt update && apt -y upgrade
apt -y install curl ca-certificates ufw fail2ban
adduser --gecos "" inkpress && usermod -aG sudo inkpress
# ... （按 §4 操作）
curl -fsSL https://get.docker.com | sh
usermod -aG docker inkpress
# ... 安装 Caddy（按 §4.6）
ufw allow 22022/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable

# === 一次性：部署应用（inkpress 用户）===
git clone <repo> ~/inkpress-service-repo
cd ~/inkpress-service-repo/inkpress-service
cp .env.example .env.production
# 编辑 .env.production，把 docker-compose.yml 改成 127.0.0.1:9527:3000
bash scripts/deploy.sh

# === 一次性：Caddy 配置 ===
sudo nano /etc/caddy/Caddyfile      # 按 §6.1
sudo systemctl enable --now caddy

# === 后续更新 ===
cd ~/inkpress-service-repo/inkpress-service
git pull
bash scripts/deploy.sh
```

---

## 附录 B：环境变量生产检查表

| 变量 | 必填 | 生产值 |
|------|------|--------|
| `DATABASE_URL` | ✅ | `file:/data/inkpress-service.db` |
| `NEXTAUTH_SECRET` | ✅ | 32+ 字符随机串 |
| `NEXTAUTH_URL` | ✅ | `https://<域名>` |
| `SECURE_COOKIES` | ✅ | `true` |
| `GITHUB_ID` / `GITHUB_SECRET` | 视需要 | 启用 GitHub 登录则必填 |
| `NEXT_PUBLIC_GITHUB_ENABLED` | 视需要 | 启用设 `1` |
| `LICENSE_KEY_PEPPER` | ✅ | 32+ 字符随机串 |
| `LICENSE_KEY_VIEW_PASSWORD` | ✅ | 强密码 |
| `LICENSE_KEY_ENCRYPTION_SECRET` | ✅ | 32 字节 base64 |
| `ACTIVATION_SECRET_KEK` | ✅ | 32 字节 base64 |
| `LICENSE_TOKEN_PRIVATE_KEY` | ✅ | `pnpm gen-token-key` 输出 |
| `LICENSE_TOKEN_PUBLIC_KEY` | ✅ | 同上 |
| `MAIL_PROVIDER` | ✅ | `smtp` 或 `resend`（不要用 `console`） |
| `MAIL_FROM` | ✅ | 与 SMTP/Resend 域名一致 |
| `ADMIN_EMAIL` | ✅ | 你的管理员邮箱 |
| `ADMIN_PASSWORD` | ✅ | 临时强密码（首登改） |
