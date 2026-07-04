#!/bin/bash
#
# 服务器首次初始化脚本（在本地执行，SSH 到服务器配置环境）
#
# 完成：
#   1. 验证 SSH 连通性
#   2. 创建项目目录结构
#   3. 上传 Dockerfile.base / docker-compose.yml / .env.example
#   4. 构建 base 镜像（一次性，~3-5 分钟）
#   5. 生成 .env.production 模板（用户需手动填写）
#   6. 提示放行防火墙端口
#
# 用法：
#   bash scripts/init-server.sh
#
# 配置：直接编辑下方 SSH_HOST / REMOTE_DIR，或通过环境变量覆盖：
#   SSH_HOST=root@1.2.3.4 bash scripts/init-server.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

# ========== 配置（按需修改）==========
SSH_KEY="${SSH_KEY:-./inkpress-service.pem}"
SSH_HOST="${SSH_HOST:-root@YOUR_SERVER_IP}"
SSH_PORT="${SSH_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/opt/inkpress-service}"
# ====================================

# 校验：SSH_HOST 必须通过环境变量或修改默认值提供
if [[ "$SSH_HOST" == *YOUR_SERVER_IP* ]]; then
  echo "❌ 未配置 SSH_HOST。请通过环境变量提供："
  echo "   SSH_HOST=root@<服务器IP> bash scripts/init-server.sh"
  echo "   或写入 ~/.zshrc / ~/.bashrc：export SSH_HOST=root@<服务器IP>"
  exit 1
fi

# 校验 SSH key 权限（必须 600，否则 ssh 拒绝）
chmod 600 "$SSH_KEY" 2>/dev/null || true

echo "=========================================="
echo "  InkPress Service 服务器初始化"
echo "=========================================="
echo "  SSH 目标: $SSH_HOST:$SSH_PORT"
echo "  部署目录: $REMOTE_DIR"
echo "  SSH 密钥: $SSH_KEY"
echo ""

# Step 0: 连通性测试
echo ">>> Step 1/6: 测试 SSH 连通性..."
if ! ssh -i "$SSH_KEY" -p "$SSH_PORT" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
     "$SSH_HOST" "echo ok" >/dev/null 2>&1; then
  echo "❌ SSH 连接失败，请检查："
  echo "   - SSH_HOST 配置是否正确（当前: $SSH_HOST）"
  echo "   - SSH_PORT 是否正确（阿里云默认 22）"
  echo "   - SSH_KEY 路径与权限（chmod 600 $SSH_KEY）"
  echo "   - 阿里云安全组是否放行 22 端口"
  exit 1
fi
echo "    ✅ SSH 可连接"

# Step 2: 创建目录结构
echo ""
echo ">>> Step 2/6: 创建项目目录结构..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" "
  set -e
  sudo mkdir -p $REMOTE_DIR/{data,backups,release}
  # 如果当前不是 root，需 sudo chown
  if [ \"\$(whoami)\" != 'root' ]; then
    sudo chown -R \$(whoami):\$(whoami) $REMOTE_DIR
  fi
  ls -la $REMOTE_DIR
"
echo "    ✅ 目录就绪"

# Step 3: 上传构建必需文件
echo ""
echo ">>> Step 3/6: 上传 Dockerfile.base / docker-compose.yml / .env.example..."
scp -i "$SSH_KEY" -P "$SSH_PORT" \
  Dockerfile.base docker-compose.yml docker-entrypoint.sh .env.example \
  "$SSH_HOST:$REMOTE_DIR/"
echo "    ✅ 文件已上传"

# Step 4: 构建 base 镜像
echo ""
echo ">>> Step 4/6: 构建基础镜像 inkpress-service-base:latest（首次约 3-5 分钟）..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" "
  set -e
  cd $REMOTE_DIR
  if docker image inspect inkpress-service-base:latest >/dev/null 2>&1; then
    echo '    base 镜像已存在，跳过'
  else
    docker build -f Dockerfile.base -t inkpress-service-base:latest .
    echo '    ✅ base 镜像构建完成'
  fi
  docker images inkpress-service-base
"

# Step 5: 准备 .env.production 模板
echo ""
echo ">>> Step 5/6: 准备 .env.production..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" "
  set -e
  cd $REMOTE_DIR
  if [ -f .env.production ]; then
    echo '    .env.production 已存在，跳过'
  else
    cp .env.example .env.production
    chmod 600 .env.production
    echo '    ✅ 已基于 .env.example 创建 .env.production'
    echo '    ⚠️  请登录服务器编辑该文件，填入生产密钥'
    echo '       ssh -i $SSH_KEY -p $SSH_PORT $SSH_HOST'
    echo '       nano $REMOTE_DIR/.env.production'
  fi
"

# Step 6: 提示放行端口
echo ""
echo ">>> Step 6/6: 防火墙提示..."
echo "    阿里云轻量服务器需在控制台 → 防火墙中放行："
echo "      - TCP 9527（应用访问，http://<IP>:9527）"
echo "      - TCP 80  （后续 Caddy 用）"
echo "      - TCP 443 （后续 HTTPS 用）"
echo ""
echo "    服务器内 ufw（如已启用）需放行："
echo "      ssh -i $SSH_KEY -p $SSH_PORT $SSH_HOST"
echo "      ufw allow 9527/tcp"
echo ""

echo "=========================================="
echo "  服务器初始化完成!"
echo "=========================================="
echo ""
echo "  接下来请："
echo "    1. 登录服务器填写 .env.production"
echo "       ssh -i $SSH_KEY -p $SSH_PORT $SSH_HOST"
echo "       nano $REMOTE_DIR/.env.production"
echo ""
echo "    2. 阿里云控制台放行 9527 端口"
echo ""
echo "    3. 本地执行首次发布："
echo "       SSH_HOST=$SSH_HOST bash scripts/release-local.sh"
echo ""
