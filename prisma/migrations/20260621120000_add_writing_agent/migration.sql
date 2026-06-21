-- CreateTable
CREATE TABLE "AgentChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "selectedProjectId" TEXT,
    "providerId" TEXT,
    "modelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentChatSession_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "partsJson" TEXT NOT NULL,
    "metadataJson" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentArticleProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "sessionId" TEXT,
    "baseVersionHash" TEXT NOT NULL,
    "title" TEXT,
    "markdown" TEXT NOT NULL,
    "digest" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "appliedAt" DATETIME,
    CONSTRAINT "AgentArticleProposal_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentChatSession_articleId_key" ON "AgentChatSession"("articleId");
CREATE INDEX "AgentChatSession_articleId_idx" ON "AgentChatSession"("articleId");
CREATE UNIQUE INDEX "AgentChatMessage_sessionId_position_key" ON "AgentChatMessage"("sessionId", "position");
CREATE INDEX "AgentChatMessage_sessionId_idx" ON "AgentChatMessage"("sessionId");
CREATE INDEX "AgentArticleProposal_articleId_idx" ON "AgentArticleProposal"("articleId");
CREATE INDEX "AgentArticleProposal_sessionId_idx" ON "AgentArticleProposal"("sessionId");
CREATE INDEX "AgentArticleProposal_status_idx" ON "AgentArticleProposal"("status");
