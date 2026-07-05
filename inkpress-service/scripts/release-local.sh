#!/bin/bash
#
# 本地发布脚本：本地编译 → rsync 推送 → 服务器构建镜像 → docker-compose 拉起
#
# 流程：
#   1. 本地：pnpm install + prisma generate + pnpm build
#   2. 本地：准备 release/ 目录（含产物 + Dockerfile.app + 依赖描述）
#   3. rsync 推送 release/ 到服务器
#   4. SSH 执行：docker build → 备份 DB → docker compose up → 健康检查
#
# 用法：
#   bash scripts/release-local.sh              # 部署 latest
#   TAG=v1.0.0 bash scripts/release-local.sh   # 部署指定 tag
#
# 配置（编辑下方或环境变量覆盖）：
#   SSH_HOST=root@1.2.3.4 bash scripts/release-local.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

# ========== 配置（与 init-server.sh 保持一致）==========
SSH_KEY="${SSH_KEY:-./inkpress-service.pem}"
SSH_HOST="${SSH_HOST:-root@YOUR_SERVER_IP}"
SSH_PORT="${SSH_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/opt/inkpress-service}"
TAG="${TAG:-latest}"
# =======================================================

# 校验：SSH_HOST 必须通过环境变量或修改默认值提供
if [[ "$SSH_HOST" == *YOUR_SERVER_IP* ]]; then
  echo "❌ 未配置 SSH_HOST。请通过环境变量提供："
  echo "   SSH_HOST=root@<服务器IP> bash scripts/release-local.sh"
  echo "   或写入 ~/.zshrc / ~/.bashrc：export SSH_HOST=root@<服务器IP>"
  exit 1
fi

chmod 600 "$SSH_KEY" 2>/dev/null || true
REMOTE="$REMOTE_DIR/release"
APP_IMAGE="inkpress-service:$TAG"

echo "=========================================="
echo "  InkPress Service 本地发布"
echo "=========================================="
echo "  目标:     $SSH_HOST:$SSH_PORT"
echo "  部署目录: $REMOTE_DIR"
echo "  镜像 tag: $TAG"
echo ""

# ===== Stage 0: 清理上次残留 =====
# 避免上一次中断的 release/ 影响 TypeScript 类型检查
rm -rf release

# ===== Stage 1: 本地构建 =====
echo ">>> Stage 1/5: 本地构建（pnpm install + prisma generate + next build）..."
if ! command -v pnpm &> /dev/null; then
  echo "❌ 本地未安装 pnpm，请先 corepack enable && corepack prepare pnpm@11.8.0 --activate"
  exit 1
fi

echo "    安装依赖..."
pnpm install --frozen-lockfile

echo "    生成 Prisma Client..."
pnpm exec prisma generate

echo "    构建 Next.js（standalone 模式）..."
# build 时强制 DATABASE_URL 指向本地 dev.db：
# Next.js build 会加载 .env.production，其中的 DATABASE_URL=file:/data/...
# 会触发 db.ts 的 mkdirSync('/data')，Mac 本地无权限创建根目录导致 build 失败。
# NEXT_PUBLIC_* 仍从 .env.production 读取，正常注入客户端 bundle。
# 运行时 DATABASE_URL 由 docker compose 的 env_file(.env.production) 注入容器。
DATABASE_URL="file:./dev.db" pnpm build
echo "    ✅ 构建完成"

# ===== Stage 2: 准备 release 目录 =====
echo ""
echo ">>> Stage 2/5: 准备 release 产物..."
rm -rf release
mkdir -p release/.next release/src

# Next.js standalone 产物（server.js + 已 trace 的依赖）
# rsync -a 比 cp -r 更鲁棒：正确处理 pnpm 的 symlink 结构
rsync -a .next/standalone/ release/.next/standalone/
# 静态资源
rsync -a .next/static/ release/.next/static/
# public 静态资源（邮件 logo 等运行时 public assets）
rsync -a public/ release/public/
# Prisma 生成代码（runtime 必需）
rsync -a src/generated/ release/src/generated/
# Prisma schema 与 migrations（容器启动 migrate deploy 需要）
# 排除 seed.ts（生产不需要）
rsync -a --exclude='seed.ts' prisma/ release/prisma/

# 指引文档（/guide 路由运行时读 docs/guide/manifest.json）
rsync -a docs/ release/docs/

# 首次 admin 引导脚本（entrypoint 自动调用，仅 DB 无 admin 时创建）
# 注意：不打包 init-production.ts（已改为手动 pnpm admin:sync，从本地代码运行）
rsync -a scripts/bootstrap-admin.ts release/scripts/

# 依赖文件（用于服务器侧 pnpm install）
cp package.json pnpm-lock.yaml pnpm-workspace.yaml release/

# Prisma 7 配置文件（在项目根，不在 prisma/ 子目录）
cp prisma.config.ts release/

# 启动脚本 + 应用镜像构建文件
cp docker-entrypoint.sh release/
cp Dockerfile.app release/Dockerfile

# 体积概览
echo "    release/ 体积：$(du -sh release | awk '{print $1}')"
echo "    ✅ 产物就绪"

# ===== Stage 3: rsync 推送到服务器 =====
echo ""
echo ">>> Stage 3/5: 推送产物到服务器..."
# --exclude '*.pem' 防止 SSH 密钥等敏感文件随 standalone trace 意外推送
rsync -az --delete \
  --exclude '*.pem' \
  --exclude '.env*' \
  -e "ssh -i $SSH_KEY -p $SSH_PORT" \
  release/ \
  "$SSH_HOST:$REMOTE/"
echo "    ✅ 推送完成"

# 同步本地 .env.production（如果存在）
# 工作流：本地维护 .env.production 作为生产配置单一来源，release 时自动推送
# .env.production 被 .gitignore 覆盖，不会进 git
if [ -f .env.production ]; then
  echo "    同步 .env.production..."
  # 服务器侧备份现有 .env.production
  ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" "
    cd $REMOTE_DIR
    [ -f .env.production ] && cp .env.production .env.production.bak.\$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
  " 2>/dev/null
  # scp 推送（密钥通过 SSH 加密传输）
  scp -i "$SSH_KEY" -P "$SSH_PORT" .env.production "$SSH_HOST:$REMOTE_DIR/.env.production" >/dev/null
  ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" "chmod 600 $REMOTE_DIR/.env.production" 2>/dev/null
  echo "    ✅ .env.production 已同步（权限 600，旧版本已备份）"
else
  echo "    ℹ️  本地无 .env.production，跳过同步（服务器现有配置不变）"
  echo "       如需本地维护生产配置：scp -i $SSH_KEY -P $SSH_PORT $SSH_HOST:$REMOTE_DIR/.env.production .env.production"
fi

# 同步 docker-compose.yml（资源限制 / healthcheck 等运维调整）
if [ -f docker-compose.yml ]; then
  echo "    同步 docker-compose.yml..."
  scp -i "$SSH_KEY" -P "$SSH_PORT" docker-compose.yml "$SSH_HOST:$REMOTE_DIR/docker-compose.yml" >/dev/null
  echo "    ✅ docker-compose.yml 已同步"
fi

# ===== Stage 4: 服务器侧构建镜像并启动 =====
echo ""
echo ">>> Stage 4/5: 服务器构建镜像 + 拉起容器..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" bash -s << REMOTE_SCRIPT
set -euo pipefail
cd "$REMOTE_DIR"

echo "    [远程] 备份 SQLite 数据库..."
mkdir -p backups data
if [ -f data/inkpress-service.db ]; then
  BACKUP="backups/inkpress-service-\$(date +%Y%m%d-%H%M%S).db"
  cp data/inkpress-service.db "\$BACKUP"
  chmod 600 "\$BACKUP"
  echo "    [远程] 已备份: \$BACKUP"
else
  echo "    [远程] 首次部署，跳过备份"
fi

echo "    [远程] 修正 data 目录所有者（容器内 nextjs UID=999）..."
chown -R 999:999 data

echo "    [远程] 构建应用镜像 $APP_IMAGE..."
cd release
docker build -t "$APP_IMAGE" .
cd "$REMOTE_DIR"

# 如果 tag 不是 latest，给 latest 也打个标签（让 docker-compose 用得了）
if [ "$TAG" != "latest" ]; then
  docker tag "$APP_IMAGE" inkpress-service:latest
fi

echo "    [远程] 启动/重启容器（entrypoint 自动执行 prisma migrate deploy）..."
docker compose --env-file .env.production up -d --force-recreate

echo "    [远程] 清理悬空镜像..."
docker image prune -f
echo "    ✅ 容器已启动"
REMOTE_SCRIPT

# ===== Stage 5: 健康检查 =====
echo ""
echo ">>> Stage 5/5: 健康检查（最长 60 秒）..."
for attempt in $(seq 1 30); do
  if ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" \
     "curl -fsS http://127.0.0.1:9527/login >/dev/null 2>&1"; then
    echo "    ✅ 应用已就绪（第 $attempt 次尝试）"
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "❌ 健康检查失败，服务器侧日志："
    ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" "cd $REMOTE_DIR && docker compose logs --tail=80"
    exit 1
  fi
  sleep 2
done

echo "    校验 CSP nonce 注入..."
if ! ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" bash -s <<'REMOTE_HEALTH'; then
set -euo pipefail
headers="$(mktemp)"
html="$(curl -fsS -D "$headers" http://127.0.0.1:9527/login)"
csp="$(tr -d "\r" < "$headers" | awk 'BEGIN{IGNORECASE=1} /^content-security-policy:/ { sub(/^[^:]*:[[:space:]]*/, ""); print; exit }')"
rm -f "$headers"
nonce="$(printf "%s" "$csp" | sed -n "s/.*nonce-\([^'; ]*\).*/\1/p")"
if [ -z "$nonce" ]; then
  echo "missing CSP nonce"
  exit 1
fi
if ! printf "%s" "$html" | grep -q "nonce=\"$nonce\""; then
  echo "HTML scripts missing CSP nonce"
  exit 1
fi
REMOTE_HEALTH
  echo "❌ CSP nonce 校验失败：/login 响应头已有 nonce，但 HTML 脚本未注入同一 nonce"
  exit 1
fi
echo "    ✅ CSP nonce 正常"

# 清理本地 release
rm -rf release

echo ""
echo "=========================================="
echo "  发布完成!"
echo "=========================================="
echo ""
SERVER_IP="${SSH_HOST#*@}"
echo "  访问: http://$SERVER_IP:9527/login"
echo ""
echo "  常用命令（本地）："
echo "    查看日志: ssh -i $SSH_KEY -p $SSH_PORT $SSH_HOST 'cd $REMOTE_DIR && docker compose logs -f'"
echo "    重启服务: ssh -i $SSH_KEY -p $SSH_PORT $SSH_HOST 'cd $REMOTE_DIR && docker compose restart'"
echo "    回滚:     TAG=<旧tag> bash scripts/release-local.sh"
echo ""
