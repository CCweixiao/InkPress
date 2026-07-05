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
SSH_HOST=root@8.217.175.141 \
SSH_KEY=./inkpress-service.pem \
bash scripts/release-local.sh
```

- 服务器 IP：`8.217.175.141`（公网 HTTPS 域名 `www.longoflow.com`）
- SSH 私钥：`inkpress-service/inkpress-service.pem`（已 gitignore，本地持有）
- 发布流程详见 `inkpress-service/docs/release-overview.md`（5 阶段：本地构建 → rsync → 远程 docker build → 启动 → 健康检查）
- 生产密钥由本地 `.env.production` 单一来源管理，发版脚本会自动 scp 推送并备份旧版本
