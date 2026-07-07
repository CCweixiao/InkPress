-- CreateTable
CREATE TABLE "DeviceTrial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceIdHash" TEXT NOT NULL,
    "machineIdHash" TEXT,
    "macHash" TEXT,
    "hostnameHash" TEXT,
    "os" TEXT,
    "arch" TEXT,
    "appVersion" TEXT,
    "trialStartedAt" DATETIME NOT NULL,
    "trialExpiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TRIAL',
    "ipFirst" TEXT,
    "ipLast" TEXT,
    "userAgentLast" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceTrial_deviceIdHash_key" ON "DeviceTrial"("deviceIdHash");

-- CreateIndex
CREATE INDEX "DeviceTrial_status_idx" ON "DeviceTrial"("status");

-- CreateIndex
CREATE INDEX "DeviceTrial_trialExpiresAt_idx" ON "DeviceTrial"("trialExpiresAt");
