-- LicenseValidationLog.createdAt 单列索引
-- 用途：TTL 清理走 `deleteMany({ where: { createdAt: { lt: cutoff } } })`，
-- 跨 licenseKeyId 全表扫描；无单列索引时退化为全表扫描 + 长事务。
-- 现有复合索引 [licenseKeyId, createdAt] 等不能被 createdAt 单条件高效利用。
CREATE INDEX "LicenseValidationLog_createdAt_idx" ON "LicenseValidationLog"("createdAt");
