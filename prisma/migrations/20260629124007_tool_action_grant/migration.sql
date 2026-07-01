-- CreateTable
CREATE TABLE "ToolActionGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "runtime" TEXT NOT NULL DEFAULT 'claude-agent',
    "toolName" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvalTokenHash" TEXT,
    "decisionJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ToolActionGrant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ToolActionGrant_sessionId_status_idx" ON "ToolActionGrant"("sessionId", "status");

-- CreateIndex
CREATE INDEX "ToolActionGrant_toolName_idx" ON "ToolActionGrant"("toolName");
