#!/bin/bash
#
# 运维加固一键脚本（本地执行，SSH 到服务器配置）：
#
#   1. 安装服务器依赖（sqlite3 + ossutil）
#   2. 配置 ossutil 凭证（写入 ~/.ossutilconfig，权限 600）
#   3. 部署 backup-to-oss.sh
#   4. 安装 cron（每天 00:00 自动备份）
#   5. 配置 Docker 日志轮转（单文件 50MB / 最多 3 份）
#   6. 立即测试执行一次
#
# 用法：
#   bash scripts/setup-ops.sh
#   SSH_HOST=root@1.2.3.4 bash scripts/setup-ops.sh
#
# 前置条件：
#   - 本地 .env.production 含 OSS_PUBLISH_* 配置（release-local.sh 已同步到服务器）
#   - init-server.sh 与 release-local.sh 已成功执行（服务器有 data/ 和 .env.production）
#
set -euo pipefail
cd "$(dirname "$0")/.."

# ========== 配置（与 release-local.sh 一致）==========
SSH_KEY="${SSH_KEY:-./inkpress-service.pem}"
SSH_HOST="${SSH_HOST:-root@YOUR_SERVER_IP}"
SSH_PORT="${SSH_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/opt/inkpress-service}"
# ======================================================

if [[ "$SSH_HOST" == *YOUR_SERVER_IP* ]]; then
  echo "❌ 未配置 SSH_HOST。请通过环境变量提供："
  echo "   SSH_HOST=root@<服务器IP> bash scripts/setup-ops.sh"
  exit 1
fi

chmod 600 "$SSH_KEY" 2>/dev/null || true

# 从本地 .env.production 读取 OSS 配置（凭证用于配置服务器侧 ossutil）
if [ ! -f .env.production ]; then
  echo "❌ 本地无 .env.production（包含 OSS_PUBLISH_* 配置）"
  echo "   先执行一次 release-local.sh 同步到服务器"
  exit 1
fi

get_env() {
  grep "^$1=" .env.production | head -1 | cut -d'=' -f2- | tr -d '"'
}
OSS_REGION=$(get_env OSS_PUBLISH_REGION)
OSS_BUCKET=$(get_env OSS_PUBLISH_BUCKET)
OSS_KEY_ID=$(get_env OSS_PUBLISH_ACCESS_KEY_ID)
OSS_KEY_SECRET=$(get_env OSS_PUBLISH_ACCESS_KEY_SECRET)

if [ -z "$OSS_REGION" ] || [ -z "$OSS_BUCKET" ] || [ -z "$OSS_KEY_ID" ] || [ -z "$OSS_KEY_SECRET" ]; then
  echo "❌ .env.production 中 OSS_PUBLISH_* 配置不完整："
  echo "   OSS_PUBLISH_REGION    = ${OSS_REGION:-（缺失）}"
  echo "   OSS_PUBLISH_BUCKET    = ${OSS_BUCKET:-（缺失）}"
  echo "   OSS_PUBLISH_ACCESS_KEY_ID = ${OSS_KEY_ID:+已设置}${OSS_KEY_ID:-（缺失）}"
  echo "   OSS_PUBLISH_ACCESS_KEY_SECRET = ${OSS_KEY_SECRET:+已设置}${OSS_KEY_SECRET:-（缺失）}"
  exit 1
fi

OSS_ENDPOINT="oss-${OSS_REGION}.aliyuncs.com"

echo "=========================================="
echo "  InkPress Service 运维加固"
echo "=========================================="
echo "  目标:       $SSH_HOST:$SSH_PORT"
echo "  部署目录:   $REMOTE_DIR"
echo "  OSS Bucket: oss://$OSS_BUCKET"
echo "  OSS 前缀:   inkpress-service/backups/"
echo "  备份策略:   每天 00:00，保留 7 天（本地 + OSS 双通道）"
echo ""

# Step 1: SSH 连通性
echo ">>> Step 1/6: 验证 SSH 连通性..."
if ! ssh -i "$SSH_KEY" -p "$SSH_PORT" -o ConnectTimeout=10 "$SSH_HOST" "echo ok" >/dev/null 2>&1; then
  echo "❌ SSH 连接失败，检查 SSH_HOST / SSH_KEY"
  exit 1
fi
echo "    ✅ SSH 可连接"

# Step 2: 安装服务器依赖
echo ""
echo ">>> Step 2/6: 安装服务器依赖（sqlite3 + ossutil）..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" bash -s <<'INSTALL_DEPS'
set -euo pipefail

# sqlite3（在线备份必需）
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "    安装 sqlite3..."
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq sqlite3 >/dev/null 2>&1
fi
SQLITE_VER=$(sqlite3 --version 2>&1 | head -1)
echo "    ✅ sqlite3: $SQLITE_VER"

# ossutil（阿里云 OSS CLI，单二进制）
OSSUTIL=/usr/local/bin/ossutil
if [ ! -x "$OSSUTIL" ]; then
  echo "    安装 ossutil v1.7.19..."
  curl -fsSL -o /tmp/ossutil64 \
    "https://gosspublic.alicdn.com/ossutil/v1/1.7.19/ossutil64" \
    || curl -fsSL -o /tmp/ossutil64 \
    "https://gosspublic.alicdn.com/ossutil/1.7.19/ossutil64"
  install -m 755 /tmp/ossutil64 "$OSSUTIL"
  rm -f /tmp/ossutil64
fi
OSSUTIL_VER=$("$OSSUTIL" version 2>&1 | head -1)
echo "    ✅ ossutil: $OSSUTIL_VER"
INSTALL_DEPS

# Step 3: 配置 ossutil 凭证
echo ""
echo ">>> Step 3/6: 配置 ossutil 凭证（写入 ~/.ossutilconfig，权限 600）..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" \
  "/usr/local/bin/ossutil config -e $OSS_ENDPOINT -i $OSS_KEY_ID -k $OSS_KEY_SECRET" \
    >/dev/null 2>&1
# 凭证写入后立即收紧权限
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" "chmod 600 ~/.ossutilconfig 2>/dev/null || true"

# 验证 OSS 连通性（列出前缀，权限+网络一次性验证）
echo "    验证 OSS 连通性..."
if ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" \
    "/usr/local/bin/ossutil ls oss://$OSS_BUCKET/ -e $OSS_ENDPOINT --limited-num 1" \
    >/dev/null 2>&1; then
  echo "    ✅ OSS 认证通过"
else
  echo "    ⚠️  OSS 认证失败，可能原因："
  echo "       - AccessKey 无该 Bucket 权限（RAM 子账号需 oss:ListObjects + oss:PutObject + oss:DeleteObject）"
  echo "       - Bucket 未开通 / Region 不匹配"
  echo "       - 服务器出网被限制"
  echo "    请排查后重跑本脚本。继续部署脚本但 cron 可能执行失败。"
fi

# Step 4: 部署 backup-to-oss.sh
echo ""
echo ">>> Step 4/6: 部署 backup-to-oss.sh 到 $REMOTE_DIR/..."
scp -i "$SSH_KEY" -P "$SSH_PORT" \
  scripts/backup-to-oss.sh \
  "$SSH_HOST:$REMOTE_DIR/backup-to-oss.sh" >/dev/null
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" \
  "chmod +x $REMOTE_DIR/backup-to-oss.sh && mkdir -p $REMOTE_DIR/backups"
echo "    ✅ 备份脚本已部署"

# Step 5: 安装 cron（每天 00:00）
echo ""
echo ">>> Step 5/6: 安装 cron 定时任务（0 0 * * *）..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" bash -s <<CRON_SETUP
set -euo pipefail
REMOTE_DIR="$REMOTE_DIR"
CRON_LINE="0 0 * * * \$REMOTE_DIR/backup-to-oss.sh"

# 幂等：先删旧条目再添加
( crontab -l 2>/dev/null | grep -v 'backup-to-oss.sh' || true; echo "\$CRON_LINE" ) | crontab -

# 确保 cron 服务运行
systemctl is-active cron >/dev/null 2>&1 || systemctl start cron 2>/dev/null || true

echo "    当前 cron 任务："
crontab -l 2>/dev/null | grep -E 'backup|inkpress' || echo "    （无）"
CRON_SETUP
echo "    ✅ cron 已安装"

# Step 6: Docker 日志轮转（docker-compose.yml 已有 logging 配置则跳过）
echo ""
echo ">>> Step 6/6: 检查 Docker 日志轮转..."
if ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" \
    "grep -q 'max-size' $REMOTE_DIR/docker-compose.yml 2>/dev/null"; then
  echo "    ✅ docker-compose.yml 已配置日志轮转"
else
  echo "    ℹ️  docker-compose.yml 未配置 logging，下次发布时会自动带上"
  echo "       （本地 docker-compose.yml 已加 logging 块，release-local.sh 会同步）"
fi

# 立即测试执行
echo ""
echo ">>> 立即测试执行一次备份..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" \
  "$REMOTE_DIR/backup-to-oss.sh" 2>&1 | sed 's/^/    /' || true

echo ""
echo "=========================================="
echo "  运维加固完成!"
echo "=========================================="
echo ""
echo "  备份策略："
echo "    - 每天 00:00 自动执行：SQLite 在线备份 → gzip → 上传 OSS"
echo "    - 本地保留 7 份 / OSS 保留 7 天"
echo "    - 日志：/var/log/inkpress-backup.log"
echo ""
echo "  常用命令："
echo "    手动备份: ssh -i $SSH_KEY -p $SSH_PORT $SSH_HOST '$REMOTE_DIR/backup-to-oss.sh'"
echo "    查看日志: ssh -i $SSH_KEY -p $SSH_PORT $SSH_HOST 'tail -50 /var/log/inkpress-backup.log'"
echo "    列 OSS:  ssh -i $SSH_KEY -p $SSH_PORT $SSH_HOST '/usr/local/bin/ossutil ls oss://$OSS_BUCKET/inkpress-service/backups/'"
echo "    查 cron: ssh -i $SSH_KEY -p $SSH_PORT $SSH_HOST 'crontab -l'"
echo ""
