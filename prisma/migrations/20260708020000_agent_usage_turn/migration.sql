-- P1.5 Token usage ledger：每轮对话的 token/cost 汇总。
-- 刻意不建 FK 到 AgentChatSession：删除消息/会话/文章不应影响历史消耗统计（PDC §12.2/§12.6）。
CREATE TABLE "AgentUsageTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "providerId" TEXT,
    "modelId" TEXT,
    "sdkSessionId" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "source" TEXT NOT NULL DEFAULT 'sdk-result',
    "modelUsageJson" TEXT NOT NULL DEFAULT '{}',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AgentUsageTurn_sessionId_startedAt_idx" ON "AgentUsageTurn"("sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentUsageTurn_targetKind_targetId_startedAt_idx" ON "AgentUsageTurn"("targetKind", "targetId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentUsageTurn_modelId_startedAt_idx" ON "AgentUsageTurn"("modelId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentUsageTurn_status_startedAt_idx" ON "AgentUsageTurn"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentUsageTurn_sessionId_turnId_key" ON "AgentUsageTurn"("sessionId", "turnId");
