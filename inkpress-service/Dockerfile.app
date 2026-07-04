# ── InkPress Service 应用镜像 ──
#
# 基于 inkpress-service-base:latest。
# 策略：全量 node_modules + Next standalone（server.js + .next 构建产物）
#
# 构建命令（在服务器执行，由 release-local.sh 自动调用）:
#   docker build -f Dockerfile.app -t inkpress-service:latest ./release

# ===== Stage 1: deps（装 node_modules）=====
FROM inkpress-service-base:latest AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# 全量安装（含 prisma CLI、@prisma/engines、dotenv、原生模块 Linux 二进制）
RUN pnpm install --frozen-lockfile

# ===== Stage 2: runner（运行时）=====
FROM inkpress-service-base:latest AS runner
WORKDIR /app
ENV NODE_ENV=production \
  PORT=3000 \
  HOSTNAME=0.0.0.0 \
  DATABASE_URL=file:/data/inkpress-service.db

# 1) 全量 node_modules（含 prisma 7 所有子依赖 + 原生模块 Linux 二进制）
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# 2) Next standalone 入口（server.js 依赖上面 node_modules + ./.next）
COPY --chown=nextjs:nodejs .next/standalone/server.js ./server.js
COPY --chown=nextjs:nodejs .next/standalone/package.json ./package.json
# 关键：把 standalone 里的 .next（chunks/server-config 等）复制过来
COPY --chown=nextjs:nodejs .next/standalone/.next ./.next

# 3) 静态资源（standalone 默认不含 .next/static）
COPY --chown=nextjs:nodejs .next/static ./.next/static
# public 静态资源（standalone 默认也不含 public）
COPY --chown=nextjs:nodejs public ./public

# 4) Prisma 生成代码（runtime 必需）+ migrations（migrate deploy 用）+ config
COPY --chown=nextjs:nodejs src/generated ./src/generated
COPY --chown=nextjs:nodejs prisma ./prisma
COPY --chown=nextjs:nodejs prisma.config.ts ./prisma.config.ts

# 5) 启动脚本（先 migrate，再启动 server）
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
