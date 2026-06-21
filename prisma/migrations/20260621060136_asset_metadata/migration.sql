/*
  Warnings:

  - Added the required column `updatedAt` to the `Asset` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ossKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "contentType" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "spaceId" TEXT,
    "articleId" TEXT,
    "trashed" BOOLEAN NOT NULL DEFAULT false,
    "trashedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- 旧表无 description/tagsJson/updatedAt：用空字符串 / 空数组 / 当前时间回填
INSERT INTO "new_Asset" ("articleId", "contentType", "createdAt", "expiresAt", "id", "kind", "name", "ossKey", "size", "spaceId", "trashed", "trashedAt", "url", "description", "tagsJson", "updatedAt") SELECT "articleId", "contentType", "createdAt", "expiresAt", "id", "kind", "name", "ossKey", "size", "spaceId", "trashed", "trashedAt", "url", '', '[]', CURRENT_TIMESTAMP FROM "Asset";
DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE INDEX "Asset_kind_idx" ON "Asset"("kind");
CREATE INDEX "Asset_createdAt_idx" ON "Asset"("createdAt");
CREATE INDEX "Asset_spaceId_idx" ON "Asset"("spaceId");
CREATE INDEX "Asset_articleId_idx" ON "Asset"("articleId");
CREATE INDEX "Asset_trashed_idx" ON "Asset"("trashed");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
