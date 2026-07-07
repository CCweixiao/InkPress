-- 统一存储对象：SQLite 保存元数据，实际文件可在本地或云存储。
CREATE TABLE "StorageObject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "bucket" TEXT,
    "key" TEXT NOT NULL,
    "localPath" TEXT,
    "url" TEXT,
    "contentType" TEXT NOT NULL DEFAULT '',
    "size" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT NOT NULL,
    "etag" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "status" TEXT NOT NULL DEFAULT 'synced',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "StorageObject_provider_key_key"
ON "StorageObject"("provider", "key");

CREATE INDEX "StorageObject_sha256_idx"
ON "StorageObject"("sha256");

CREATE INDEX "StorageObject_provider_idx"
ON "StorageObject"("provider");

CREATE INDEX "StorageObject_createdAt_idx"
ON "StorageObject"("createdAt");

ALTER TABLE "Asset" ADD COLUMN "storageObjectId" TEXT REFERENCES "StorageObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD COLUMN "metadataJson" TEXT NOT NULL DEFAULT '{}';

CREATE INDEX "Asset_storageObjectId_idx"
ON "Asset"("storageObjectId");

CREATE TABLE "CodeGraphCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'graphify',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "spaceId" TEXT,
    "articleId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "projectName" TEXT NOT NULL DEFAULT '',
    "root" TEXT NOT NULL DEFAULT '',
    "snapshotHash" TEXT NOT NULL DEFAULT '',
    "gitHead" TEXT,
    "graphAssetId" TEXT,
    "reportAssetId" TEXT,
    "htmlAssetId" TEXT,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "edgeCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "CodeGraphCache_sourceKey_idx"
ON "CodeGraphCache"("sourceKey");

CREATE INDEX "CodeGraphCache_spaceId_idx"
ON "CodeGraphCache"("spaceId");

CREATE INDEX "CodeGraphCache_articleId_idx"
ON "CodeGraphCache"("articleId");

CREATE INDEX "CodeGraphCache_snapshotHash_idx"
ON "CodeGraphCache"("snapshotHash");

CREATE INDEX "CodeGraphCache_status_idx"
ON "CodeGraphCache"("status");
