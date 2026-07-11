-- Migration B: 移除 Task.spaceId，listId 改为 NOT NULL + FK RESTRICT

-- 回填 listId（保险：若有遗漏的 null，指向默认清单）
UPDATE "Task" SET "listId" = 'cl_default_list_seed_fixed' WHERE "listId" IS NULL;

-- 用 new_Task recreate：移除 spaceId，listId NOT NULL + FK RESTRICT
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dueDate" DATETIME,
    "dueTime" TEXT,
    "isAllDay" BOOLEAN NOT NULL DEFAULT true,
    "completedAt" DATETIME,
    "parentId" TEXT,
    "listId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "isCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "trashed" BOOLEAN NOT NULL DEFAULT false,
    "trashedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TaskList" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("completedAt", "content", "createdAt", "dueDate", "dueTime", "id", "isAllDay", "isCollapsed", "listId", "parentId", "priority", "sortOrder", "status", "tagsJson", "title", "trashed", "trashedAt", "expiresAt", "updatedAt")
SELECT "completedAt", "content", "createdAt", "dueDate", "dueTime", "id", "isAllDay", "isCollapsed", "listId", "parentId", "priority", "sortOrder", "status", "tagsJson", "title", "trashed", "trashedAt", "expiresAt", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_listId_status_sortOrder_idx" ON "Task"("listId", "status", "sortOrder");
CREATE INDEX "Task_status_dueDate_idx" ON "Task"("status", "dueDate");
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");
CREATE INDEX "Task_priority_status_idx" ON "Task"("priority", "status");
CREATE INDEX "Task_trashed_idx" ON "Task"("trashed");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
