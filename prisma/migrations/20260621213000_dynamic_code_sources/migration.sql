CREATE TABLE "CodeSourceGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "root" TEXT,
    "owner" TEXT,
    "repo" TEXT,
    "ref" TEXT,
    "cacheRoot" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'session',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvalTokenHash" TEXT,
    "approvedAt" DATETIME,
    "lastAccessedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodeSourceGrant_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "AgentChatSession" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CodeSourceGrant_sessionId_sourceKey_key"
ON "CodeSourceGrant"("sessionId", "sourceKey");

CREATE INDEX "CodeSourceGrant_sessionId_status_idx"
ON "CodeSourceGrant"("sessionId", "status");

CREATE INDEX "CodeSourceGrant_sourceKey_idx"
ON "CodeSourceGrant"("sourceKey");

ALTER TABLE "TechnicalDocument"
ADD COLUMN "codeSourceJson" TEXT NOT NULL DEFAULT '{}';
