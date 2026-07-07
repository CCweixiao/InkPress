-- 订阅计划表：首页价格展示与管理员维护。
-- 价格以分（cents）存储避免浮点；features 用 JSON 字符串数组。
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubscriptionPlan_slug_key" UNIQUE ("slug")
);

CREATE INDEX "SubscriptionPlan_status_sortOrder_idx" ON "SubscriptionPlan"("status", "sortOrder");
