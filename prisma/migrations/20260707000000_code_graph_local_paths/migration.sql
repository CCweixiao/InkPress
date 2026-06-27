ALTER TABLE "CodeGraphCache" ADD COLUMN "graphPath" TEXT;
ALTER TABLE "CodeGraphCache" ADD COLUMN "reportPath" TEXT;
ALTER TABLE "CodeGraphCache" ADD COLUMN "htmlPath" TEXT;

CREATE INDEX "CodeGraphCache_sourceKey_snapshotHash_status_idx"
ON "CodeGraphCache"("sourceKey", "snapshotHash", "status");
