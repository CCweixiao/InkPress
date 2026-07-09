-- CreateTable
CREATE TABLE "ReleaseVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "changelogMarkdown" TEXT,
    "highlightsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "channel" TEXT NOT NULL DEFAULT 'stable',
    "source" TEXT NOT NULL DEFAULT 'ci',
    "releasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReleaseAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "arch" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileHashSha256" TEXT,
    "downloadUrl" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'admin',
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReleaseAsset_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ReleaseVersion" ("id") ON DELETE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseVersion_packageName_version_key" ON "ReleaseVersion"("packageName", "version");
CREATE INDEX "ReleaseVersion_packageName_status_releasedAt_idx" ON "ReleaseVersion"("packageName", "status", "releasedAt");
CREATE INDEX "ReleaseVersion_packageName_channel_idx" ON "ReleaseVersion"("packageName", "channel");
CREATE UNIQUE INDEX "ReleaseAsset_versionId_os_arch_key" ON "ReleaseAsset"("versionId", "os", "arch");
CREATE INDEX "ReleaseAsset_versionId_idx" ON "ReleaseAsset"("versionId");
CREATE INDEX "ReleaseAsset_os_arch_idx" ON "ReleaseAsset"("os", "arch");

-- ========================================
-- 数据迁移：SoftwareRelease → ReleaseVersion + ReleaseAsset
-- ========================================

-- 步骤 A: 每个 (packageName, version) 取最新行，插入 ReleaseVersion
INSERT INTO "ReleaseVersion" (
  "id", "packageName", "version", "displayName", "logoUrl",
  "changelogMarkdown", "highlightsJson", "status", "channel",
  "source", "releasedAt", "createdAt", "updatedAt"
)
SELECT
  lower(hex(randomblob(12))),
  packageName,
  version,
  displayName,
  logoUrl,
  changelogMarkdown,
  highlightsJson,
  status,
  channel,
  source,
  releasedAt,
  createdAt,
  updatedAt
FROM (
  SELECT sr.*,
    row_number() OVER (PARTITION BY sr.packageName, sr.version ORDER BY sr.releasedAt DESC) rn
  FROM "SoftwareRelease" sr
) ranked
WHERE ranked.rn = 1;

-- 步骤 B: 每条 SoftwareRelease → ReleaseAsset，platform 拆 os+arch
-- platform 取值固定为 "darwin-arm64" / "darwin-x64" / "win32-x64" / "linux-x64"
-- storageKey: 从 downloadUrl 提取 pathname 作为 OSS key，失败则用 downloadUrl 本身
INSERT INTO "ReleaseAsset" (
  "id", "versionId", "os", "arch",
  "fileName", "fileSizeBytes", "fileHashSha256",
  "downloadUrl", "storageKey", "source", "downloadCount",
  "createdAt", "updatedAt"
)
SELECT
  lower(hex(randomblob(12))),
  rv.id,
  substr(sr.platform, 1, instr(sr.platform, '-') - 1),
  substr(sr.platform, instr(sr.platform, '-') + 1),
  sr.fileName,
  sr.fileSizeBytes,
  sr.fileHashSha256,
  sr.downloadUrl,
  -- storageKey：尝试从 url 提取 path，否则用完整 url
  CASE
    WHEN instr(sr.downloadUrl, '://') > 0 THEN
      substr(sr.downloadUrl, instr(sr.downloadUrl, '://') + 4)
    ELSE sr.downloadUrl
  END,
  sr.source,
  sr.downloadCount,
  sr.createdAt,
  sr.updatedAt
FROM "SoftwareRelease" sr
JOIN "ReleaseVersion" rv ON rv.packageName = sr.packageName AND rv.version = sr.version;

-- ========================================
-- 删除旧表
-- ========================================

-- DropTable
DROP TABLE "SoftwareRelease";
