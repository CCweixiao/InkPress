-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SoftwareRelease" (
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
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'ci',
    "releasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SoftwareRelease" ("changelogMarkdown", "channel", "createdAt", "displayName", "downloadUrl", "fileHashSha256", "fileName", "fileSizeBytes", "highlightsJson", "id", "logoUrl", "packageName", "platform", "releasedAt", "source", "status", "updatedAt", "version") SELECT "changelogMarkdown", "channel", "createdAt", "displayName", "downloadUrl", "fileHashSha256", "fileName", "fileSizeBytes", "highlightsJson", "id", "logoUrl", "packageName", "platform", "releasedAt", "source", "status", "updatedAt", "version" FROM "SoftwareRelease";
DROP TABLE "SoftwareRelease";
ALTER TABLE "new_SoftwareRelease" RENAME TO "SoftwareRelease";
CREATE INDEX "SoftwareRelease_packageName_status_releasedAt_idx" ON "SoftwareRelease"("packageName", "status", "releasedAt");
CREATE INDEX "SoftwareRelease_packageName_channel_idx" ON "SoftwareRelease"("packageName", "channel");
CREATE UNIQUE INDEX "SoftwareRelease_packageName_platform_version_key" ON "SoftwareRelease"("packageName", "platform", "version");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
