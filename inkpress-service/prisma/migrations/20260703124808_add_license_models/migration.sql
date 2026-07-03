-- CreateTable
CREATE TABLE "LicenseKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyHash" TEXT NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "displayKeySuffix" TEXT NOT NULL,
    "durationKind" TEXT NOT NULL,
    "durationYears" INTEGER,
    "durationDays" INTEGER,
    "effectiveExpiresAt" DATETIME,
    "maxDevices" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ENABLED',
    "inviterUserId" TEXT,
    "inviterCode" TEXT,
    "note" TEXT,
    "batchNo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "firstActivatedAt" DATETIME,
    "disabledAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LicenseActivation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "licenseKeyId" TEXT NOT NULL,
    "deviceIdHash" TEXT NOT NULL,
    "macHash" TEXT,
    "machineIdHash" TEXT,
    "hostnameHash" TEXT,
    "os" TEXT,
    "arch" TEXT,
    "appVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activationSecretHash" TEXT,
    "activatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastValidatedAt" DATETIME,
    "deactivatedAt" DATETIME,
    "revokedAt" DATETIME,
    "revokedReason" TEXT,
    "ipFirst" TEXT,
    "ipLast" TEXT,
    "userAgentLast" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LicenseActivation_licenseKeyId_fkey" FOREIGN KEY ("licenseKeyId") REFERENCES "LicenseKey" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LicenseValidationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "licenseKeyId" TEXT,
    "activationId" TEXT,
    "deviceIdHash" TEXT,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "appVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "LicenseKey_keyHash_key" ON "LicenseKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseKey_keyFingerprint_key" ON "LicenseKey"("keyFingerprint");

-- CreateIndex
CREATE INDEX "LicenseKey_status_idx" ON "LicenseKey"("status");

-- CreateIndex
CREATE INDEX "LicenseKey_inviterUserId_idx" ON "LicenseKey"("inviterUserId");

-- CreateIndex
CREATE INDEX "LicenseKey_batchNo_idx" ON "LicenseKey"("batchNo");

-- CreateIndex
CREATE INDEX "LicenseKey_createdAt_idx" ON "LicenseKey"("createdAt");

-- CreateIndex
CREATE INDEX "LicenseActivation_deviceIdHash_idx" ON "LicenseActivation"("deviceIdHash");

-- CreateIndex
CREATE INDEX "LicenseActivation_status_idx" ON "LicenseActivation"("status");

-- CreateIndex
CREATE INDEX "LicenseActivation_lastValidatedAt_idx" ON "LicenseActivation"("lastValidatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseActivation_licenseKeyId_deviceIdHash_key" ON "LicenseActivation"("licenseKeyId", "deviceIdHash");

-- CreateIndex
CREATE INDEX "LicenseValidationLog_licenseKeyId_createdAt_idx" ON "LicenseValidationLog"("licenseKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "LicenseValidationLog_activationId_createdAt_idx" ON "LicenseValidationLog"("activationId", "createdAt");

-- CreateIndex
CREATE INDEX "LicenseValidationLog_deviceIdHash_createdAt_idx" ON "LicenseValidationLog"("deviceIdHash", "createdAt");

-- CreateIndex
CREATE INDEX "LicenseValidationLog_action_result_createdAt_idx" ON "LicenseValidationLog"("action", "result", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
