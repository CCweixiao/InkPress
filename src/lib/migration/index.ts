/**
 * 版本化迁移框架入口。
 *
 * 设计参考 Flyway schema_history：
 * - DB 表 migration_history 为事务安全的真相源
 * - ~/.inkpress/database/scripts/<version>/.success 为审计文件标识
 * - 支持跨版本（跳版本）更新：按时间戳升序补齐未执行版本
 * - 迁移前自动备份（滚动保留 5 份）
 * - 旧库兼容：自动导入 _prisma_migrations 历史
 */
export { runMigrations } from "@/lib/migration/runner";
export {
  HISTORY_TABLE,
  ensureHistoryTable,
  getAppliedVersions,
  importLegacyPrismaHistory,
} from "@/lib/migration/history";
export { backupDatabase } from "@/lib/migration/backup";
