#!/bin/sh
set -e

echo "[entrypoint] prisma migrate deploy ..."
# 幂等：无新 migration 时直接跳过
node ./node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] 初始化 admin + 订阅计划（幂等）..."
# 幂等：admin 已存在 / plan 已一致则跳过
# 失败不阻塞 server 启动（运维可后续手动修复）
node ./node_modules/tsx/dist/cli.mjs scripts/init-production.ts || \
  echo "[entrypoint] init-production 失败（继续启动 server）"

echo "[entrypoint] starting inkpress-service ..."
exec node server.js
