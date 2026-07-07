-- 新增 License 归属邮箱字段，用于将 License 绑定到未来/已注册用户。
-- 历史 License 该字段为 NULL，管理端可后续手动补录。
ALTER TABLE "LicenseKey" ADD COLUMN "ownerEmail" TEXT;

-- 按邮箱查询当前用户的所有 License，高频访问场景建索引。
CREATE INDEX "LicenseKey_ownerEmail_idx" ON "LicenseKey"("ownerEmail");
