#!/bin/sh
set -e

echo "[entrypoint] prisma migrate deploy ..."
# 幂等：无新 migration 时直接跳过
node ./node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] 首次 admin 引导（仅在 DB 无 admin 时创建）..."
# 仅首次部署创建 admin；已有 admin 一律跳过，不做密码同步
# 失败不阻塞 server 启动（运维可后续手动 admin:sync 修复）
node ./node_modules/tsx/dist/cli.mjs scripts/bootstrap-admin.ts || \
  echo "[entrypoint] bootstrap-admin 失败（继续启动 server）"

echo "[entrypoint] starting inkpress-service ..."
exec node server.js
