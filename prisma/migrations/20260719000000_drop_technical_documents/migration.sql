-- 删除技术文档子系统（功能由「灵感/Snippets」覆盖）
-- 先删依赖 TechnicalDocument 的两张子表（虽 onDelete:Cascade，显式删更安全）
DROP TABLE IF EXISTS "AgentTechnicalDocumentProposal";
DROP TABLE IF EXISTS "TechnicalDocumentVersion";
DROP TABLE IF EXISTS "TechnicalDocument";

-- AgentChatSession 上的 technicalDocumentId 列、唯一约束、索引
-- SQLite：prisma migrate 用 table-rebuild 兼容旧版 SQLite（DROP COLUMN 在 3.35+ 才支持）
DROP INDEX IF EXISTS "AgentChatSession_technicalDocumentId_key";
DROP INDEX IF EXISTS "AgentChatSession_technicalDocumentId_idx";

-- CreateTable: AgentChatSession 重建（移除 technicalDocumentId 列）
CREATE TABLE "new_AgentChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT,
    "targetKind" TEXT NOT NULL DEFAULT 'article',
    "summary" TEXT NOT NULL DEFAULT '',
    "summaryUpToPosition" INTEGER NOT NULL DEFAULT -1,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "activeTurnId" TEXT,
    "activeTurnExpiresAt" DATETIME,
    "selectedProjectId" TEXT,
    "providerId" TEXT,
    "modelId" TEXT,
    "runtime" TEXT NOT NULL DEFAULT 'claude-agent',
    "claudeAgentSessionId" TEXT,
    "claudeAgentStoreKey" TEXT,
    "claudeAgentSessionStatus" TEXT NOT NULL DEFAULT 'none',
    "claudeAgentLastEventAt" DATETIME,
    "claudeAgentLastError" TEXT,
    "claudeAgentInterruptedAt" DATETIME,
    "claudeAgentResumeCount" INTEGER NOT NULL DEFAULT 0,
    "lastInputTokens" INTEGER NOT NULL DEFAULT 0,
    "lastOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "lastReasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "lastTotalTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_AgentChatSession" ("id", "articleId", "targetKind", "summary", "summaryUpToPosition", "generation", "activeTurnId", "activeTurnExpiresAt", "selectedProjectId", "providerId", "modelId", "runtime", "claudeAgentSessionId", "claudeAgentStoreKey", "claudeAgentSessionStatus", "claudeAgentLastEventAt", "claudeAgentLastError", "claudeAgentInterruptedAt", "claudeAgentResumeCount", "lastInputTokens", "lastOutputTokens", "lastReasoningTokens", "lastTotalTokens", "createdAt", "updatedAt")
SELECT "id", "articleId", "targetKind", "summary", "summaryUpToPosition", "generation", "activeTurnId", "activeTurnExpiresAt", "selectedProjectId", "providerId", "modelId", "runtime", "claudeAgentSessionId", "claudeAgentStoreKey", "claudeAgentSessionStatus", "claudeAgentLastEventAt", "claudeAgentLastError", "claudeAgentInterruptedAt", "claudeAgentResumeCount", "lastInputTokens", "lastOutputTokens", "lastReasoningTokens", "lastTotalTokens", "createdAt", "updatedAt"
FROM "AgentChatSession";

DROP TABLE "AgentChatSession";
ALTER TABLE "new_AgentChatSession" RENAME TO "AgentChatSession";

CREATE UNIQUE INDEX "AgentChatSession_articleId_key" ON "AgentChatSession"("articleId");
CREATE INDEX "AgentChatSession_articleId_idx" ON "AgentChatSession"("articleId");
CREATE INDEX "AgentChatSession_activeTurnExpiresAt_idx" ON "AgentChatSession"("activeTurnExpiresAt");
