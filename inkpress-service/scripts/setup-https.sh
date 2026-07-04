#!/bin/bash
#
# 一键配置 HTTPS（Caddy + Let's Encrypt）+ 反向代理 443 → 127.0.0.1:9527
#
# 流程（全部通过 SSH 远程执行）：
#   1. 本地校验域名 DNS 解析到目标服务器
#   2. 测试 SSH 连通
#   3. 远程安装 Caddy（如未安装）
#   4. 备份并修改 docker-compose.yml：9527:3000 → 127.0.0.1:9527:3000
#   5. 备份并修改 .env.production：NEXTAUTH_URL / SECURE_COOKIES
#   6. 重启容器（应用新配置）
#   7. 写入 Caddyfile + 配置 ufw 放行 80/443
#   8. 启动 Caddy，等待 Let's Encrypt 证书签发（最多 120 秒）
#   9. 健康检查 https://<域名>/login
#
# 用法：
#   SSH_HOST=root@8.217.175.141 bash scripts/setup-https.sh
#   SSH_HOST=root@8.217.175.141 DOMAIN=www.longoflow.com bash scripts/setup-https.sh
#
# 前置条件：
#   - 域名 DNS A 记录已解析到服务器 IP
#   - 阿里云安全组已放行 TCP 80 和 443（证书申请依赖 80 端口可达）
#   - SSH 密钥可登录服务器（默认 root 用户）
#
set -euo pipefail
cd "$(dirname "$0")/.."

# ========== 配置 ==========
SSH_KEY="${SSH_KEY:-./inkpress-service.pem}"
SSH_HOST="${SSH_HOST:-root@YOUR_SERVER_IP}"
SSH_PORT="${SSH_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/opt/inkpress-service}"
DOMAIN="${DOMAIN:-www.longoflow.com}"
# ==========================

if [[ "$SSH_HOST" == *YOUR_SERVER_IP* ]]; then
  echo "❌ 未配置 SSH_HOST。"
  echo "   用法: SSH_HOST=root@<服务器IP> DOMAIN=$DOMAIN bash $0"
  exit 1
fi

chmod 600 "$SSH_KEY" 2>/dev/null || true
SERVER_IP="${SSH_HOST#*@}"
SSH_OPTS=(-i "$SSH_KEY" -p "$SSH_PORT" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

echo "=========================================="
echo "  HTTPS 配置（Caddy + Let's Encrypt）"
echo "=========================================="
echo "  服务器:    $SSH_HOST ($SERVER_IP)"
echo "  域名:      $DOMAIN"
echo "  部署目录:  $REMOTE_DIR"
echo ""
echo "  ⚠️  前置：请确认阿里云安全组已放行 TCP 80 和 443"
echo ""

# ===== Step 1: SSH 连通 =====
echo ">>> Step 1/9: 测试 SSH 连通..."
if ! ssh "${SSH_OPTS[@]}" "$SSH_HOST" "echo ok" >/dev/null 2>&1; then
  echo "    ❌ SSH 连接失败，检查 SSH_HOST / SSH_KEY / SSH_PORT"
  exit 1
fi
echo "    ✅ SSH 可连接"

# ===== Step 2: 服务器侧 DNS 解析校验 =====
# 必须在服务器侧校验：本地 Mac 可能被代理软件（Clash/Surge）污染返回 fake-ip，
# 服务器看到的解析才是 Let's Encrypt 实际看到的。
echo ">>> Step 2/9: 校验 DNS 解析（在服务器侧执行）..."
RESOLVED_IP=$(ssh "${SSH_OPTS[@]}" "$SSH_HOST" "
  command -v dig >/dev/null && dig +short $DOMAIN A 2>/dev/null | grep -E '^[0-9]+\.' | head -1 \
  || command -v getent >/dev/null && getent hosts $DOMAIN | awk '{print \$1}' \
  || command -v host >/dev/null && host -t A $DOMAIN 2>/dev/null | awk '{print \$NF}' | head -1
" 2>/dev/null | grep -E '^[0-9]+\.' | head -1 || true)

if [[ -z "$RESOLVED_IP" ]]; then
  echo "    ❌ 服务器侧无法解析 $DOMAIN"
  echo "       请确认 DNS A 记录已配置并传播: $DOMAIN → $SERVER_IP"
  exit 1
fi
if [[ "$RESOLVED_IP" != "$SERVER_IP" ]]; then
  echo "    ❌ $DOMAIN 解析到 $RESOLVED_IP，与服务器 $SERVER_IP 不一致"
  echo "       Let's Encrypt 校验会失败。请检查 DNS 配置或等待传播"
  exit 1
fi
echo "    ✅ $DOMAIN → $SERVER_IP（服务器侧解析正确）"

# ===== Step 3: 安装 Caddy =====
echo ">>> Step 3/9: 远程安装 Caddy..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" 'bash -s' << 'REMOTE_INSTALL'
set -euo pipefail
if command -v caddy &> /dev/null; then
  echo "    ✅ Caddy 已安装: $(caddy version 2>&1 | head -1)"
else
  echo "    安装 Caddy（添加官方 apt 源）..."
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
  echo "    ✅ Caddy 已安装: $(caddy version 2>&1 | head -1)"
fi
REMOTE_INSTALL

# ===== Step 4: 修改 docker-compose.yml =====
echo ">>> Step 4/9: 修改 docker-compose.yml 端口绑定（9527 → 127.0.0.1:9527）..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" 'bash -s' -- "$REMOTE_DIR" << 'REMOTE_FIX_COMPOSE'
set -euo pipefail
REMOTE_DIR="$1"
cd "$REMOTE_DIR"

[ -f docker-compose.yml ] || { echo "    ❌ docker-compose.yml 不存在"; exit 1; }

cp docker-compose.yml "docker-compose.yml.bak.$(date +%Y%m%d-%H%M%S)"

if grep -q '"127.0.0.1:9527:3000"' docker-compose.yml; then
  echo "    ✅ 端口已是 127.0.0.1:9527:3000，跳过"
elif grep -q '"9527:3000"' docker-compose.yml; then
  sed -i 's|"9527:3000"|"127.0.0.1:9527:3000"|g' docker-compose.yml
  echo "    ✅ 端口绑定改为 127.0.0.1:9527:3000（仅本机访问）"
else
  echo "    ⚠️  未识别到 9527 端口配置，请手动检查 docker-compose.yml"
  grep -nA3 'ports:' docker-compose.yml || true
  exit 1
fi
REMOTE_FIX_COMPOSE

# ===== Step 5: 修改 .env.production =====
echo ">>> Step 5/9: 更新 .env.production（NEXTAUTH_URL / SECURE_COOKIES）..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" 'bash -s' -- "$REMOTE_DIR" "$DOMAIN" << 'REMOTE_FIX_ENV'
set -euo pipefail
REMOTE_DIR="$1"
DOMAIN="$2"
cd "$REMOTE_DIR"

[ -f .env.production ] || { echo "    ❌ .env.production 不存在"; exit 1; }

cp .env.production ".env.production.bak.$(date +%Y%m%d-%H%M%S)"

if grep -q '^NEXTAUTH_URL=' .env.production; then
  sed -i "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=\"https://$DOMAIN\"|" .env.production
else
  echo "NEXTAUTH_URL=\"https://$DOMAIN\"" >> .env.production
fi

if grep -q '^SECURE_COOKIES=' .env.production; then
  sed -i 's|^SECURE_COOKIES=.*|SECURE_COOKIES=true|' .env.production
else
  echo "SECURE_COOKIES=true" >> .env.production
fi

chmod 600 .env.production
echo "    ✅ NEXTAUTH_URL=https://$DOMAIN"
echo "    ✅ SECURE_COOKIES=true"
REMOTE_FIX_ENV

# ===== Step 6: 重启容器 =====
echo ">>> Step 6/9: 重启容器（应用新端口与 env）..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" 'bash -s' -- "$REMOTE_DIR" << 'REMOTE_RESTART'
set -euo pipefail
REMOTE_DIR="$1"
cd "$REMOTE_DIR"

docker compose --env-file .env.production up -d --force-recreate >/dev/null
echo "    ✅ 容器已重启"

sleep 3
if curl -fsS http://127.0.0.1:9527/login >/dev/null 2>&1; then
  echo "    ✅ 容器内服务健康（127.0.0.1:9527）"
else
  echo "    ⚠️  容器健康检查失败，查看: docker compose logs --tail=50"
fi
REMOTE_RESTART

# ===== Step 7: 写 Caddyfile + ufw =====
echo ">>> Step 7/9: 写入 Caddyfile + 配置防火墙..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" 'bash -s' -- "$DOMAIN" << 'REMOTE_CADDY'
set -euo pipefail
DOMAIN="$1"

[ -f /etc/caddy/Caddyfile ] && cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d-%H%M%S)"
mkdir -p /var/log/caddy

cat > /etc/caddy/Caddyfile << CADDYFILE
# InkPress Service 反向代理 + 自动 HTTPS
# 由 setup-https.sh 生成于 $(date +%Y-%m-%d)
# 证书由 Caddy 自动向 Let's Encrypt 申请并续期

$DOMAIN {
    encode zstd gzip

    # 反向代理到 Docker 容器
    reverse_proxy 127.0.0.1:9527 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # 安全响应头（next.config.ts 已下发大部分，这里做边缘兜底）
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        -Server
    }

    # Next.js 静态资源长缓存
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
CADDYFILE

echo "    ✅ /etc/caddy/Caddyfile 已写入"

if command -v ufw &> /dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp  comment 'HTTP (Caddy)'  >/dev/null 2>&1 || true
  ufw allow 443/tcp comment 'HTTPS (Caddy)' >/dev/null 2>&1 || true
  echo "    ✅ ufw 已放行 80/443"
else
  echo "    ⚠️  ufw 未启用或未安装，跳过（务必确认阿里云安全组已放行 80/443）"
fi
REMOTE_CADDY

# ===== Step 8: 启动 Caddy + 等待证书 =====
echo ">>> Step 8/9: 启动 Caddy，等待 Let's Encrypt 证书签发（最长 120 秒）..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" 'bash -s' -- "$DOMAIN" << 'REMOTE_START'
set -euo pipefail
DOMAIN="$1"

systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
sleep 3

if ! systemctl is-active --quiet caddy; then
  echo "    ❌ Caddy 启动失败"
  echo "       排查: journalctl -u caddy --no-pager -n 50"
  exit 1
fi
echo "    ✅ Caddy 已启动，开始申请证书..."

for attempt in $(seq 1 40); do
  if curl -fsS --max-time 5 "https://$DOMAIN/login" >/dev/null 2>&1; then
    echo "    ✅ HTTPS 已就绪（约 $((attempt * 3)) 秒）"
    exit 0
  fi
  sleep 3
done

echo "    ❌ 证书签发或健康检查超时（120 秒）。最常见原因："
echo "       1. 阿里云安全组未放行 TCP 80/443（Let's Encrypt HTTP-01 校验需 80 可达）"
echo "       2. DNS 未传播: dig +short $DOMAIN"
echo "       3. Caddy 日志: journalctl -u caddy --no-pager -n 80"
exit 1
REMOTE_START

# ===== Step 9: 最终验证 =====
echo ">>> Step 9/9: 最终验证..."
sleep 2

HTTPS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://$DOMAIN/login" 2>/dev/null || echo "000")
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://$DOMAIN/login" 2>/dev/null || echo "000")

echo ""
echo "=========================================="
echo "  HTTPS 配置完成"
echo "=========================================="
echo ""
echo "  https://$DOMAIN/login → HTTP $HTTPS_CODE"
if [[ "$HTTP_CODE" == "301" ]]; then
  echo "  http://$DOMAIN → 301 重定向到 HTTPS ✅"
else
  echo "  http://$DOMAIN → HTTP $HTTP_CODE（期望 301）"
fi
echo ""
echo "  证书由 Let's Encrypt 自动签发，Caddy 自动续期（无需 cron）"
echo ""
echo "  常用运维命令："
echo "    Caddy 状态: ssh -i $SSH_KEY -p $SSH_PORT $SSH_HOST 'systemctl status caddy'"
echo "    Caddy 日志: ssh -i $SSH_KEY -p $SSH_PORT $SSH_HOST 'journalctl -u caddy -f'"
echo "    应用日志:   ssh -i $SSH_KEY -p $SSH_PORT $SSH_HOST 'cd $REMOTE_DIR && docker compose logs -f'"
echo ""
echo "  ⚠️  后续可在阿里云安全组移除 TCP 9527（Caddy 已接管流量）"
echo ""
