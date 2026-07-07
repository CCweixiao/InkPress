-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "outTradeNo" TEXT NOT NULL,
    "planSlug" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "planConfigJson" TEXT NOT NULL DEFAULT '{}',
    "subject" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "tradeNo" TEXT,
    "buyerLogonId" TEXT,
    "licenseKeyId" TEXT,
    "paidAt" DATETIME,
    "closedAt" DATETIME,
    "notifyCount" INTEGER NOT NULL DEFAULT 0,
    "lastNotifyAt" DATETIME,
    "createdIp" TEXT,
    "createdUa" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("amountCents", "buyerLogonId", "closedAt", "createdAt", "createdIp", "createdUa", "id", "lastNotifyAt", "licenseKeyId", "notifyCount", "outTradeNo", "paidAt", "planConfigJson", "planName", "planSlug", "status", "subject", "tradeNo", "updatedAt", "userId") SELECT "amountCents", "buyerLogonId", "closedAt", "createdAt", "createdIp", "createdUa", "id", "lastNotifyAt", "licenseKeyId", "notifyCount", "outTradeNo", "paidAt", "planConfigJson", "planName", "planSlug", "status", "subject", "tradeNo", "updatedAt", "userId" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_outTradeNo_key" ON "Order"("outTradeNo");
CREATE INDEX "Order_userId_status_idx" ON "Order"("userId", "status");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_outTradeNo_idx" ON "Order"("outTradeNo");
CREATE TABLE "new_SubscriptionPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "durationKind" TEXT NOT NULL,
    "durationYears" INTEGER,
    "maxDevices" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "discountPriceCents" INTEGER,
    "featuresJson" TEXT NOT NULL DEFAULT '[]',
    "highlight" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "dailyStockLimit" INTEGER,
    "dailyStockResetAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SubscriptionPlan" ("createdAt", "discountPriceCents", "durationKind", "durationYears", "featuresJson", "highlight", "id", "maxDevices", "name", "priceCents", "slug", "sortOrder", "status", "tagline", "updatedAt") SELECT "createdAt", "discountPriceCents", "durationKind", "durationYears", "featuresJson", "highlight", "id", "maxDevices", "name", "priceCents", "slug", "sortOrder", "status", "tagline", "updatedAt" FROM "SubscriptionPlan";
DROP TABLE "SubscriptionPlan";
ALTER TABLE "new_SubscriptionPlan" RENAME TO "SubscriptionPlan";
CREATE UNIQUE INDEX "SubscriptionPlan_slug_key" ON "SubscriptionPlan"("slug");
CREATE INDEX "SubscriptionPlan_status_sortOrder_idx" ON "SubscriptionPlan"("status", "sortOrder");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
