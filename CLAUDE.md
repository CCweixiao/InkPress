## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## 生产发布（inkpress-service）

发布命令与服务器信息（每次发版直接复用，无需重新询问用户）：

```bash
cd inkpress-service
SSH_HOST=root@<YOUR_SERVER_IP> \
SSH_KEY=./inkpress-service.pem \
bash scripts/release-local.sh
```

- 服务器 IP：通过本地 `.env.production` 或运维文档获取（公网 HTTPS 域名 `www.longoflow.com`）
- SSH 私钥：`inkpress-service/inkpress-service.pem`（已 gitignore，本地持有）
- 发布流程详见 `inkpress-service/docs/release-overview.md`（5 阶段：本地构建 → rsync → 远程 docker build → 启动 → 健康检查）
- 生产密钥由本地 `.env.production` 单一来源管理，发版脚本会自动 scp 推送并备份旧版本

## 数据初始化策略（重要）

entrypoint **不会**自动跑 init 脚本去 mutate 业务数据。流程是：

- **entrypoint 启动时只做两件事**：
  1. `prisma migrate deploy`（运行所有未应用的 versioned migration）
  2. `bootstrap-admin.ts`（**仅**在 DB 完全没有 admin 时按 `ADMIN_EMAIL/ADMIN_PASSWORD` 创建一个；已有 admin 一律跳过，不做密码同步）
- **业务数据变更（plan 定价、新 plan、配置数据等）** → 写 `prisma/migrations/<timestamp>_<name>/migration.sql`，跟着版本走
- **admin 密码同步/重置**（运维场景，按 .env.production 最新值覆盖 DB）→ 手动跑：
  ```bash
  cd inkpress-service
  dotenv -e .env.production -- pnpm admin:sync
  ```
  （`pnpm admin:sync` = `tsx scripts/init-production.ts`，会做 admin 密码同步 + plan 幂等 seed）

**绝对不要**为了让某次发版「顺带」改数据，去改 bootstrap-admin.ts 或在 entrypoint 里塞新脚本。数据变更的唯一入口是 migration 文件。
