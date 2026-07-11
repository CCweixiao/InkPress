ALTER TABLE "Task" ADD COLUMN "sectionId" TEXT;
ALTER TABLE "TaskList" ADD COLUMN "viewMode" TEXT NOT NULL DEFAULT 'list';
ALTER TABLE "TaskList" ADD COLUMN "groupMode" TEXT NOT NULL DEFAULT 'status';

CREATE TABLE "TaskSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "listId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskSection_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TaskList" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TaskSection_listId_sortOrder_idx" ON "TaskSection"("listId", "sortOrder");
CREATE INDEX "Task_sectionId_sortOrder_idx" ON "Task"("sectionId", "sortOrder");
