-- CreateTable
CREATE TABLE "ClaudeAgentSessionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectKey" TEXT NOT NULL,
    "sdkSessionId" TEXT NOT NULL,
    "subpath" TEXT NOT NULL DEFAULT '',
    "uuid" TEXT,
    "entryJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ClaudeAgentSessionEntry_projectKey_sdkSessionId_subpath_idx" ON "ClaudeAgentSessionEntry"("projectKey", "sdkSessionId", "subpath");

-- CreateIndex
CREATE UNIQUE INDEX "ClaudeAgentSessionEntry_projectKey_sdkSessionId_subpath_uuid_key" ON "ClaudeAgentSessionEntry"("projectKey", "sdkSessionId", "subpath", "uuid");
