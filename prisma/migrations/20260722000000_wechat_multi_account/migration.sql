CREATE TABLE "WechatAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "tagsJson" TEXT NOT NULL DEFAULT '[]',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastError" TEXT,
  "lastCheckedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "WechatAccount_appId_key" ON "WechatAccount"("appId");
CREATE INDEX "WechatAccount_isDefault_idx" ON "WechatAccount"("isDefault");
CREATE INDEX "WechatAccount_status_idx" ON "WechatAccount"("status");

CREATE TABLE "AssetWechatBinding" (
  "assetId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("assetId", "accountId"),
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("accountId") REFERENCES "WechatAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AssetWechatBinding_accountId_idx" ON "AssetWechatBinding"("accountId");

CREATE TABLE "WechatAssetSync" (
  "assetId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "wxMediaId" TEXT,
  "wxUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "syncedAt" DATETIME,
  PRIMARY KEY ("assetId", "accountId"),
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("accountId") REFERENCES "WechatAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WechatAssetSync_accountId_status_idx" ON "WechatAssetSync"("accountId", "status");

CREATE TABLE "WechatArticlePublish" (
  "articleId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "mediaId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "lastError" TEXT,
  "pushedAt" DATETIME,
  PRIMARY KEY ("articleId", "accountId"),
  FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("accountId") REFERENCES "WechatAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WechatArticlePublish_accountId_status_idx" ON "WechatArticlePublish"("accountId", "status");
