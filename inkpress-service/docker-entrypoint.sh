#!/bin/sh
set -e

echo "[entrypoint] prisma migrate deploy ..."
# 幂等：无新 migration 时直接跳过
node ./node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] starting inkpress-service ..."
exec node server.js
