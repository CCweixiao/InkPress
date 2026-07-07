-- CreateTable
CREATE TABLE "Snippet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "imageUrl" TEXT,
    "imageAssetId" TEXT,
    "imagesJson" TEXT NOT NULL DEFAULT '[]',
    "quoteSource" TEXT,
    "linkUrl" TEXT,
    "linkTitle" TEXT,
    "linkDescription" TEXT,
    "linkImage" TEXT,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "color" TEXT,
    "sourceArticleId" TEXT,
    "sourceUrl" TEXT,
    "embedding" TEXT,
    "aiSummary" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "trashed" BOOLEAN NOT NULL DEFAULT false,
    "trashedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Snippet_sourceArticleId_fkey" FOREIGN KEY ("sourceArticleId") REFERENCES "Article" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SnippetUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snippetId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "insertedVia" TEXT NOT NULL DEFAULT 'at-mention',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SnippetUsage_snippetId_fkey" FOREIGN KEY ("snippetId") REFERENCES "Snippet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SnippetUsage_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Snippet_kind_idx" ON "Snippet"("kind");

-- CreateIndex
CREATE INDEX "Snippet_pinned_createdAt_idx" ON "Snippet"("pinned", "createdAt");

-- CreateIndex
CREATE INDEX "Snippet_trashed_idx" ON "Snippet"("trashed");

-- CreateIndex
CREATE INDEX "Snippet_createdAt_idx" ON "Snippet"("createdAt");

-- CreateIndex
CREATE INDEX "Snippet_usageCount_idx" ON "Snippet"("usageCount");

-- CreateIndex
CREATE INDEX "Snippet_sourceArticleId_idx" ON "Snippet"("sourceArticleId");

-- CreateIndex
CREATE INDEX "SnippetUsage_snippetId_idx" ON "SnippetUsage"("snippetId");

-- CreateIndex
CREATE INDEX "SnippetUsage_articleId_idx" ON "SnippetUsage"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "SnippetUsage_snippetId_articleId_key" ON "SnippetUsage"("snippetId", "articleId");
