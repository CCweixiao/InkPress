# Prisma Migration 指南（SQLite）

> 适用场景：每次发布都通过 `prisma migrate deploy` 应用增量 SQL，**不破坏**核心数据（License / User / Order / LicenseActivation）。
>
> 目标读者：改动 `schema.prisma` 的开发者。

---

## 0. 机制速览

```
schema.prisma 改动
    │
    ▼
pnpm prisma migrate dev --name xxx       # 本地生成迁移 SQL
    │
    ▼
git add prisma/migrations/* + commit     # 人工 review SQL 后再 commit
    │
    ▼
release-local.sh rsync prisma/ 到服务器
    │
    ▼
docker-entrypoint.sh 容器启动时跑：
    prisma migrate deploy                # 只应用未记录的迁移
    │
    ▼
exec node server.js
```

### 关键安全保障

| 机制 | 作用 |
|---|---|
| `_prisma_migrations` 表 | 记录已应用迁移名，**已应用的不重跑** |
| `migrate deploy`（非 `migrate dev`） | **只增不删**，生产绝不会 reset |
| 按时间戳顺序应用 | 顺序确定，跨开发者协作不冲突 |
| 启动前自动备份 | `release-local.sh:147-155` 每次发布 `cp` 整库到 `backups/` |

---

## 1. 日常开发流程

### 1.1 改 schema

```prisma
// prisma/schema.prisma
model LicenseKey {
  id                String   @id @default(cuid())
  // ... 既有字段
  note              String?  // 新增字段
}
```

### 1.2 生成 migration

```bash
pnpm prisma migrate dev --name add_license_note
```

Prisma 会：
1. 比对 `schema.prisma` 与上次迁移的差异
2. 生成 `prisma/migrations/{timestamp}_add_license_note/migration.sql`
3. **本地立即应用**（开发库），跑完后本地 DB 已变

### 1.3 Review SQL（必做）

```bash
cat prisma/migrations/*_add_license_note/migration.sql
```

**红线检查清单**（见 §2）。

### 1.4 Commit + 发布

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): LicenseKey 加 note 字段"
git push

# 发布到生产
SSH_HOST=root@<ip> bash scripts/release-local.sh
```

`release-local.sh` 会自动：
1. `rsync` 同步 `prisma/` 到服务器（含新 migration 目录）
2. 服务器 `docker compose up --force-recreate`
3. 容器启动跑 `prisma migrate deploy` 应用新迁移

---

## 2. 核心数据保护红线

**核心表**：`LicenseKey` / `LicenseActivation` / `User` / `Order` / `SubscriptionPlan` / `EmailVerificationCode` / `AuditLog`（仅业务关键部分）

### 红线 1：禁止 DROP / TRUNCATE / RENAME 既有表

```sql
-- ❌ 绝对禁止
DROP TABLE LicenseKey;
TRUNCATE User;
ALTER TABLE Order RENAME TO Orders;
```

### 红线 2：既有列禁止破坏性变更

| 操作 | 风险 | 替代方案 |
|---|---|---|
| `DROP COLUMN` | SQLite < 3.35 不支持；新版本支持但**清空数据** | 标记为废弃，应用层不再读写 |
| 改列类型 | SQLite 不直接支持 | 加新列 → 数据迁移 → 旧列标记废弃 |
| 加 `NOT NULL` 约束 | 旧数据可能不满足，迁移失败 | 加列时给 `DEFAULT`，或不加 NOT NULL |
| 改主键 | 数据丢失风险极高 | 不改；用 `id` 业务列做软关联 |

### 红线 3：索引加在线表大列时需评估

```sql
-- ✅ 安全：LicenseValidationLog 已有 TTL 1 天，表很小
CREATE INDEX "LicenseValidationLog_createdAt_idx" ON "LicenseValidationLog"("createdAt");

-- ⚠️ 风险：在百万行 LicenseActivation 上加索引
-- SQLite CREATE INDEX 是 online 的（不阻塞读写），但磁盘 IO 仍可能打满 2c2g
-- 大表索引请在低峰期发布，发布前先 vacuum：
--   sqlite3 data/inkpress-service.db 'VACUUM;'
```

### 红线 4：新表 / 新列必须有 DEFAULT 或可空

```prisma
// ✅ 推荐
model LicenseKey {
  note        String?  // 可空
  source      String   @default("manual")  // 有默认值
}

// ❌ 危险：旧数据写入会报错
model LicenseKey {
  source      String   // 无默认值，旧 INSERT 必须显式提供
}
```

---

## 3. Review Checklist

每次 commit migration 文件前，过一遍：

- [ ] SQL 文件已人工阅读，确认无 `DROP TABLE` / `TRUNCATE` / `RENAME TO`
- [ ] 新加列要么可空，要么有 `DEFAULT`
- [ ] 没有改既有列类型 / 主键 / NOT NULL 约束
- [ ] 索引添加在大表上时已评估 IO 影响
- [ ] 复杂迁移（多语句 / 数据搬运）已在本地 dry-run 验证
- [ ] commit message 说清楚 schema 改了什么

---

## 4. 紧急回滚

迁移失败时容器起不来，按这个顺序处理：

### 4.1 看日志定位失败迁移

```bash
ssh root@<ip>
cd /opt/inkpress-service
docker compose logs --tail=100 | grep -A5 -i "migrate"
```

失败信息通常长这样：

```
Error: P3010: Migration 20260705120000_xxx failed to apply
```

### 4.2 从发布前备份恢复

`release-local.sh` 每次发布前会 `cp data/inkpress-service.db backups/inkpress-service-{timestamp}.db`：

```bash
cd /opt/inkpress-service
docker compose stop

# 找最近一次备份
ls -lt backups/ | head -3

# 恢复
cp backups/inkpress-service-20260705-110000.db data/inkpress-service.db
chown 999:999 data/inkpress-service.db

# 用上一个稳定 tag 重启（强制回滚镜像）
docker tag inkpress-service:<旧tag> inkpress-service:latest
docker compose up -d
```

### 4.3 标记失败迁移为已回滚（最后手段）

如果只想跳过某个失败迁移而不恢复整库（**慎用**）：

```bash
sqlite3 data/inkpress-service.db \
  "DELETE FROM _prisma_migrations WHERE migration = '20260705120000_xxx';"
```

⚠️ 这会让 Prisma 以为该迁移未应用，下次启动还会重跑。仅当迁移 SQL 已被修正后使用。

---

## 5. 常见操作示例

### 5.1 加列（最常见，安全）

```bash
pnpm prisma migrate dev --name add_user_avatar_url
```

生成 SQL：
```sql
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;
```

✅ 安全：旧数据 `avatarUrl` 为 NULL，不影响。

### 5.2 加索引

```bash
pnpm prisma migrate dev --name add_user_email_idx
```

生成 SQL：
```sql
CREATE INDEX "User_email_idx" ON "User"("email");
```

✅ 安全：SQLite online CREATE INDEX，不阻塞读写。

### 5.3 改列类型（用 4 步法）

需求：`User.status` 从 `TEXT` 改成 `ENUM`-like 约束值。

SQLite 不支持直接改类型，需要：

```sql
-- 1. 建新列
ALTER TABLE "User" ADD COLUMN "statusNew" TEXT;
-- 2. 数据迁移
UPDATE "User" SET "statusNew" = "status";
-- 3. （旧列标记废弃，不删；应用层切到新列）
-- 4. 后续版本观察稳定后再 DROP 旧列（如需）
```

⚠️ 手写 migration：`pnpm prisma migrate dev --create-only --name xxx` 生成空文件后人工写 SQL。

### 5.4 加 NOT NULL 约束到既有列

```sql
-- ❌ 直接加会因 NULL 旧数据失败
-- ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;

-- ✅ 分两步：先确保无 NULL，再加约束
UPDATE "User" SET "email" = 'unknown@local' WHERE "email" IS NULL;
-- SQLite 不支持 ALTER COLUMN SET NOT NULL，需用"建新表+复制+drop+rename"4 步法
```

### 5.5 新建表

```bash
pnpm prisma migrate dev --name add_ticket_system
```

✅ 完全安全：不影响任何既有表。

---

## 6. 进阶：本地 dry-run 验证

复杂迁移上线前，用生产数据快照本地跑一遍：

```bash
# 1. 从服务器拉一份生产 DB
scp -i inkpress-service.pem \
  root@<ip>:/opt/inkpress-service/data/inkpress-service.db \
  ./prod-snapshot.db

# 2. 临时指向快照库
DATABASE_URL="file:$(pwd)/prod-snapshot.db" \
  pnpm prisma migrate deploy

# 3. 验证数据完整
sqlite3 prod-snapshot.db \
  "SELECT COUNT(*) FROM LicenseKey; SELECT COUNT(*) FROM User;"

# 4. 验证完删除快照（含敏感数据，不要 commit）
rm prod-snapshot.db
```

---

## 7. 参考资料

- [Prisma Migrate 官方文档](https://www.prisma.io/docs/orm/prisma-migrate)
- SQLite ALTER TABLE 限制：<https://www.sqlite.org/lang_altertable.html>
- 项目发布脚本：`scripts/release-local.sh`
- 容器启动脚本：`docker-entrypoint.sh`
- 现有迁移：`prisma/migrations/`
