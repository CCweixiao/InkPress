-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "trashed" BOOLEAN NOT NULL DEFAULT false,
    "trashedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT '',
    "contentMd" TEXT NOT NULL DEFAULT '',
    "contentPath" TEXT,
    "digest" TEXT,
    "coverMediaId" TEXT,
    "coverAssetId" TEXT,
    "themeId" TEXT,
    "spaceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "wxMediaId" TEXT,
    "trashed" BOOLEAN NOT NULL DEFAULT false,
    "trashedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Article_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Article_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Article" ("contentMd", "coverMediaId", "createdAt", "digest", "id", "status", "themeId", "title", "updatedAt", "wxMediaId") SELECT "contentMd", "coverMediaId", "createdAt", "digest", "id", "status", "themeId", "title", "updatedAt", "wxMediaId" FROM "Article";
DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE INDEX "Article_themeId_idx" ON "Article"("themeId");
CREATE INDEX "Article_spaceId_idx" ON "Article"("spaceId");
CREATE INDEX "Article_trashed_idx" ON "Article"("trashed");
CREATE TABLE "new_Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ossKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "contentType" TEXT NOT NULL DEFAULT '',
    "spaceId" TEXT,
    "articleId" TEXT,
    "trashed" BOOLEAN NOT NULL DEFAULT false,
    "trashedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Asset" ("contentType", "createdAt", "id", "kind", "name", "ossKey", "size", "url") SELECT "contentType", "createdAt", "id", "kind", "name", "ossKey", "size", "url" FROM "Asset";
DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE INDEX "Asset_kind_idx" ON "Asset"("kind");
CREATE INDEX "Asset_createdAt_idx" ON "Asset"("createdAt");
CREATE INDEX "Asset_spaceId_idx" ON "Asset"("spaceId");
CREATE INDEX "Asset_articleId_idx" ON "Asset"("articleId");
CREATE INDEX "Asset_trashed_idx" ON "Asset"("trashed");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Space_trashed_idx" ON "Space"("trashed");
