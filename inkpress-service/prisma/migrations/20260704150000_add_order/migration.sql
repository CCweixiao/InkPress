-- 订单表：支付宝当面付自助购买。下单时快照套餐配置，回调时事务内发券。
-- LicenseKeyId 软引用 Order ↔ LicenseKey（不同限界上下文，不建外键）。
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
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
    CONSTRAINT "Order_outTradeNo_key" UNIQUE ("outTradeNo"),
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Order_pkey" ON "Order"("id");

CREATE INDEX "Order_userId_status_idx" ON "Order"("userId", "status");

CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

CREATE INDEX "Order_outTradeNo_idx" ON "Order"("outTradeNo");
