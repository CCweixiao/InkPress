# InkPress 服务端部署镜像（Next.js standalone server）
# 多阶段构建：builder 编译产物 → runner 仅含运行时

# ─────────── Stage 1: builder ───────────
FROM node:22-alpine AS builder
WORKDIR /app

# better-sqlite3 需要原生编译工具
RUN apk add --no-cache python3 make g++ libc6-compat

# 先装依赖（利用 Docker 层缓存）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN corepack enable && corepack prepare pnpm@latest --activate \
  && pnpm install --frozen-lockfile

# 复制源码并构建
COPY . .
RUN pnpm prisma generate \
  && pnpm build \
  && pnpm tsx scripts/prepare-standalone.ts

# ─────────── Stage 2: runner ───────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat tini

# 从 builder 拷贝 standalone bundle（已去符号链接）+ 只读资源
COPY --from=builder /app/.next/standalone-bundle ./standalone
COPY --from=builder /app/.next/standalone-bundle/.next/static ./standalone/.next/static
COPY --from=builder /app/themes ./standalone/themes
COPY --from=builder /app/resources/skills/system ./standalone/resources/skills/system
COPY --from=builder /app/prisma/migrations ./standalone/migrations
COPY --from=builder /app/package.json ./standalone/package.json

# 用户数据卷：INKPRESS_HOME 指向此目录，容器无状态
ENV INKPRESS_HOME=/data
# 资源根：显式指向 standalone（系统 skill / 主题 / 迁移脚本所在）
ENV RESOURCE_ROOT=/app/standalone
ENV INKPRESS_RESOURCES_DIR=/app/standalone
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

EXPOSE 3000

WORKDIR /app/standalone
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
