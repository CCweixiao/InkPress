-- Add dueTime and isAllDay fields (additive, non-breaking)
ALTER TABLE "Task" ADD COLUMN "dueTime" TEXT;
ALTER TABLE "Task" ADD COLUMN "isAllDay" BOOLEAN NOT NULL DEFAULT true;

-- Drop old single-column indexes
DROP INDEX IF EXISTS "Task_spaceId_idx";
DROP INDEX IF EXISTS "Task_status_idx";
DROP INDEX IF EXISTS "Task_priority_idx";
DROP INDEX IF EXISTS "Task_dueDate_idx";
DROP INDEX IF EXISTS "Task_sortOrder_idx";
-- Note: Task_parentId_idx is kept (still used as single-column in new schema)

-- Create new composite indexes
CREATE INDEX "Task_spaceId_status_sortOrder_idx" ON "Task"("spaceId", "status", "sortOrder");
CREATE INDEX "Task_status_dueDate_idx" ON "Task"("status", "dueDate");
CREATE INDEX "Task_priority_status_idx" ON "Task"("priority", "status");
