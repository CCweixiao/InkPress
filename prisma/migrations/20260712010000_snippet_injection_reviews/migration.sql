CREATE TABLE "SnippetInjectionReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "composerJson" TEXT NOT NULL,
  "snippetsJson" TEXT NOT NULL,
  "analysisJson" TEXT NOT NULL DEFAULT '{}',
  "visibleText" TEXT NOT NULL,
  "runtimeText" TEXT NOT NULL,
  "providerId" TEXT,
  "modelId" TEXT,
  "error" TEXT,
  "appliedAt" DATETIME,
  "rejectedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SnippetInjectionReview_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "AgentChatSession" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SnippetInjectionReview_sessionId_createdAt_idx"
ON "SnippetInjectionReview"("sessionId", "createdAt");

CREATE INDEX "SnippetInjectionReview_sessionId_status_idx"
ON "SnippetInjectionReview"("sessionId", "status");
