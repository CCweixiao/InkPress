PRAGMA foreign_keys=OFF;

CREATE TABLE "TechnicalDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT '',
    "documentType" TEXT NOT NULL DEFAULT 'architecture',
    "projectId" TEXT NOT NULL,
    "contentPath" TEXT,
    "snapshotHash" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "TechnicalDocumentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "technicalDocumentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL DEFAULT '',
    "sourceSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TechnicalDocumentVersion_technicalDocumentId_fkey" FOREIGN KEY ("technicalDocumentId") REFERENCES "TechnicalDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AgentTechnicalDocumentProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "technicalDocumentId" TEXT NOT NULL,
    "sessionId" TEXT,
    "baseVersionHash" TEXT NOT NULL,
    "baseTitle" TEXT NOT NULL DEFAULT '',
    "baseMarkdown" TEXT NOT NULL DEFAULT '',
    "baseSnapshotHash" TEXT NOT NULL DEFAULT '',
    "title" TEXT,
    "markdown" TEXT NOT NULL,
    "snapshotHash" TEXT,
    "sourceSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "appliedAt" DATETIME,
    "decidedAt" DATETIME,
    CONSTRAINT "AgentTechnicalDocumentProposal_technicalDocumentId_fkey" FOREIGN KEY ("technicalDocumentId") REFERENCES "TechnicalDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "new_AgentChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT,
    "technicalDocumentId" TEXT,
    "targetKind" TEXT NOT NULL DEFAULT 'article',
    "summary" TEXT NOT NULL DEFAULT '',
    "summaryUpToPosition" INTEGER NOT NULL DEFAULT -1,
    "selectedProjectId" TEXT,
    "providerId" TEXT,
    "modelId" TEXT,
    "lastInputTokens" INTEGER NOT NULL DEFAULT 0,
    "lastOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "lastReasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "lastTotalTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentChatSession_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentChatSession_technicalDocumentId_fkey" FOREIGN KEY ("technicalDocumentId") REFERENCES "TechnicalDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentChatSession_target_check" CHECK (
      ("targetKind" = 'article' AND "articleId" IS NOT NULL AND "technicalDocumentId" IS NULL) OR
      ("targetKind" = 'technical-document' AND "articleId" IS NULL AND "technicalDocumentId" IS NOT NULL)
    )
);

INSERT INTO "new_AgentChatSession" (
    "id", "articleId", "targetKind", "summary", "summaryUpToPosition",
    "selectedProjectId", "providerId", "modelId", "lastInputTokens",
    "lastOutputTokens", "lastReasoningTokens", "lastTotalTokens",
    "createdAt", "updatedAt"
)
SELECT
    "id", "articleId", 'article', "summary", "summaryUpToPosition",
    "selectedProjectId", "providerId", "modelId", "lastInputTokens",
    "lastOutputTokens", "lastReasoningTokens", "lastTotalTokens",
    "createdAt", "updatedAt"
FROM "AgentChatSession";

DROP TABLE "AgentChatSession";
ALTER TABLE "new_AgentChatSession" RENAME TO "AgentChatSession";

CREATE UNIQUE INDEX "AgentChatSession_articleId_key" ON "AgentChatSession"("articleId");
CREATE UNIQUE INDEX "AgentChatSession_technicalDocumentId_key" ON "AgentChatSession"("technicalDocumentId");
CREATE INDEX "AgentChatSession_articleId_idx" ON "AgentChatSession"("articleId");
CREATE INDEX "AgentChatSession_technicalDocumentId_idx" ON "AgentChatSession"("technicalDocumentId");
CREATE INDEX "TechnicalDocument_projectId_idx" ON "TechnicalDocument"("projectId");
CREATE INDEX "TechnicalDocument_updatedAt_idx" ON "TechnicalDocument"("updatedAt");
CREATE UNIQUE INDEX "TechnicalDocumentVersion_technicalDocumentId_version_key" ON "TechnicalDocumentVersion"("technicalDocumentId", "version");
CREATE INDEX "TechnicalDocumentVersion_technicalDocumentId_idx" ON "TechnicalDocumentVersion"("technicalDocumentId");
CREATE INDEX "AgentTechnicalDocumentProposal_technicalDocumentId_idx" ON "AgentTechnicalDocumentProposal"("technicalDocumentId");
CREATE INDEX "AgentTechnicalDocumentProposal_sessionId_idx" ON "AgentTechnicalDocumentProposal"("sessionId");
CREATE INDEX "AgentTechnicalDocumentProposal_status_idx" ON "AgentTechnicalDocumentProposal"("status");

PRAGMA foreign_keys=ON;
