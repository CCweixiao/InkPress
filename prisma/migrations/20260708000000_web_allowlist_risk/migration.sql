-- P2.5 web_fetch domain allowlist. This table is user-level and global:
-- when a normalized domain matches here, canUseTool auto-allows web_fetch.
CREATE TABLE "WebFetchDomainAllowlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "riskJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "WebFetchDomainAllowlist_domain_key"
ON "WebFetchDomainAllowlist"("domain");

CREATE INDEX "WebFetchDomainAllowlist_domain_idx"
ON "WebFetchDomainAllowlist"("domain");
