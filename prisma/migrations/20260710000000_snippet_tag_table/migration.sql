-- CreateTable
CREATE TABLE "SnippetTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SnippetTagAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snippetId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SnippetTagAssignment_snippetId_fkey" FOREIGN KEY ("snippetId") REFERENCES "Snippet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SnippetTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "SnippetTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "storageObjectId" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "description" TEXT NOT NULL DEFAULT '',
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "spaceId" TEXT,
    "articleId" TEXT,
    "trashed" BOOLEAN NOT NULL DEFAULT false,
    "trashedAt" DATETIME,
    "expiresAt" DATETIME,
    "wxMediaId" TEXT,
    "wxUrl" TEXT,
    "wxSyncStatus" TEXT,
    "wxSyncError" TEXT,
    "wxSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Asset_storageObjectId_fkey" FOREIGN KEY ("storageObjectId") REFERENCES "StorageObject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Asset" ("articleId", "contentType", "createdAt", "description", "expiresAt", "id", "kind", "metadataJson", "name", "ossKey", "size", "spaceId", "storageObjectId", "tagsJson", "trashed", "trashedAt", "updatedAt", "url", "wxMediaId", "wxSyncError", "wxSyncStatus", "wxSyncedAt", "wxUrl") SELECT "articleId", "contentType", "createdAt", "description", "expiresAt", "id", "kind", "metadataJson", "name", "ossKey", "size", "spaceId", "storageObjectId", "tagsJson", "trashed", "trashedAt", "updatedAt", "url", "wxMediaId", "wxSyncError", "wxSyncStatus", "wxSyncedAt", "wxUrl" FROM "Asset";
DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE INDEX "Asset_kind_idx" ON "Asset"("kind");
CREATE INDEX "Asset_createdAt_idx" ON "Asset"("createdAt");
CREATE INDEX "Asset_storageObjectId_idx" ON "Asset"("storageObjectId");
CREATE INDEX "Asset_spaceId_idx" ON "Asset"("spaceId");
CREATE INDEX "Asset_articleId_idx" ON "Asset"("articleId");
CREATE INDEX "Asset_trashed_idx" ON "Asset"("trashed");
CREATE INDEX "Asset_wxSyncStatus_idx" ON "Asset"("wxSyncStatus");
CREATE TABLE "new_ClaudeAgentSessionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectKey" TEXT NOT NULL,
    "sdkSessionId" TEXT NOT NULL,
    "subpath" TEXT NOT NULL DEFAULT '',
    "uuid" TEXT,
    "entryJson" TEXT NOT NULL,
    "appendSeq" INTEGER,
    "entryType" TEXT,
    "entryTimestamp" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_ClaudeAgentSessionEntry" ("appendSeq", "createdAt", "entryJson", "entryTimestamp", "entryType", "id", "projectKey", "sdkSessionId", "subpath", "updatedAt", "uuid") SELECT "appendSeq", "createdAt", "entryJson", "entryTimestamp", "entryType", "id", "projectKey", "sdkSessionId", "subpath", "updatedAt", "uuid" FROM "ClaudeAgentSessionEntry";
DROP TABLE "ClaudeAgentSessionEntry";
ALTER TABLE "new_ClaudeAgentSessionEntry" RENAME TO "ClaudeAgentSessionEntry";
CREATE INDEX "ClaudeAgentSessionEntry_projectKey_sdkSessionId_subpath_idx" ON "ClaudeAgentSessionEntry"("projectKey", "sdkSessionId", "subpath");
CREATE INDEX "ClaudeAgentSessionEntry_projectKey_sdkSessionId_subpath_appendSeq_idx" ON "ClaudeAgentSessionEntry"("projectKey", "sdkSessionId", "subpath", "appendSeq");
CREATE INDEX "ClaudeAgentSessionEntry_entryType_idx" ON "ClaudeAgentSessionEntry"("entryType");
CREATE UNIQUE INDEX "ClaudeAgentSessionEntry_projectKey_sdkSessionId_subpath_uuid_key" ON "ClaudeAgentSessionEntry"("projectKey", "sdkSessionId", "subpath", "uuid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SnippetTag_name_key" ON "SnippetTag"("name");

-- CreateIndex
CREATE INDEX "SnippetTag_name_idx" ON "SnippetTag"("name");

-- CreateIndex
CREATE INDEX "SnippetTagAssignment_snippetId_idx" ON "SnippetTagAssignment"("snippetId");

-- CreateIndex
CREATE INDEX "SnippetTagAssignment_tagId_idx" ON "SnippetTagAssignment"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "SnippetTagAssignment_snippetId_tagId_key" ON "SnippetTagAssignment"("snippetId", "tagId");

-- P4-21 数据回填：从 Snippet.tagsJson 迁移到 SnippetTag + SnippetTagAssignment。
-- 依赖 SQLite json_each / randomblob（better-sqlite3 自带 3.45+）。
-- tagsJson 列保留（安全网），不 DROP。

-- 1) distinct tag name → SnippetTag
INSERT OR IGNORE INTO "SnippetTag" (id, name)
SELECT lower(hex(randomblob(16))), j.value
FROM (
  SELECT DISTINCT je.value AS value
  FROM "Snippet", json_each("Snippet"."tagsJson") AS je
  WHERE je.value IS NOT NULL AND length(CAST(je.value AS TEXT)) > 0
) AS j;

-- 2) (snippet, tag) → SnippetTagAssignment（INSERT OR IGNORE 容忍同 snippet JSON 内重复 tag）
INSERT OR IGNORE INTO "SnippetTagAssignment" (id, snippetId, tagId)
SELECT lower(hex(randomblob(16))), s."id", t."id"
FROM "Snippet" s, json_each(s."tagsJson") AS je
JOIN "SnippetTag" t ON t."name" = je.value
WHERE je.value IS NOT NULL AND length(CAST(je.value AS TEXT)) > 0;
