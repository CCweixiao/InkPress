-- CreateTable
CREATE TABLE "SoftwareRelease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageName" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileHashSha256" TEXT,
    "downloadUrl" TEXT NOT NULL,
    "changelogMarkdown" TEXT,
    "highlightsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "channel" TEXT NOT NULL DEFAULT 'stable',
    "source" TEXT NOT NULL DEFAULT 'ci',
    "releasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SoftwareRelease_packageName_status_releasedAt_idx" ON "SoftwareRelease"("packageName", "status", "releasedAt");

-- CreateIndex
CREATE INDEX "SoftwareRelease_packageName_channel_idx" ON "SoftwareRelease"("packageName", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "SoftwareRelease_packageName_platform_version_key" ON "SoftwareRelease"("packageName", "platform", "version");
