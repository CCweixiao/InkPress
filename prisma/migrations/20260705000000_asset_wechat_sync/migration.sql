-- AlterTable: Asset 新增公众号素材库同步状态字段
-- 仅当上传时勾选「同步到公众号素材库」才写入；null = 未尝试过同步
ALTER TABLE "Asset" ADD COLUMN "wxMediaId" TEXT;
ALTER TABLE "Asset" ADD COLUMN "wxUrl" TEXT;
ALTER TABLE "Asset" ADD COLUMN "wxSyncStatus" TEXT;
ALTER TABLE "Asset" ADD COLUMN "wxSyncError" TEXT;
ALTER TABLE "Asset" ADD COLUMN "wxSyncedAt" DATETIME;

-- 索引：便于素材库列表按同步状态过滤（筛选失败素材重试）
CREATE INDEX "Asset_wxSyncStatus_idx" ON "Asset"("wxSyncStatus");
