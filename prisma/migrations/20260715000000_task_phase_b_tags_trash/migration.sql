-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TaskTag" (
    "taskId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("taskId", "tagId"),
    CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
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
    "spaceId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "isCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "trashed" BOOLEAN NOT NULL DEFAULT false,
    "trashedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("completedAt", "content", "createdAt", "dueDate", "dueTime", "id", "isAllDay", "isCollapsed", "parentId", "priority", "sortOrder", "spaceId", "status", "tagsJson", "title", "updatedAt") SELECT "completedAt", "content", "createdAt", "dueDate", "dueTime", "id", "isAllDay", "isCollapsed", "parentId", "priority", "sortOrder", "spaceId", "status", "tagsJson", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_spaceId_status_sortOrder_idx" ON "Task"("spaceId", "status", "sortOrder");
CREATE INDEX "Task_status_dueDate_idx" ON "Task"("status", "dueDate");
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");
CREATE INDEX "Task_priority_status_idx" ON "Task"("priority", "status");
CREATE INDEX "Task_trashed_idx" ON "Task"("trashed");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "TaskTag_tagId_idx" ON "TaskTag"("tagId");

-- 数据迁移：把现有 Task.tagsJson 字符串灌进 Tag + TaskTag
INSERT OR IGNORE INTO "Tag" ("id", "name", "color", "sortOrder", "createdAt", "updatedAt")
SELECT DISTINCT
  'tag_' || lower(hex(randomblob(8))),
  "name",
  '#6b7280',
  0,
  datetime('now'),
  datetime('now')
FROM (
  SELECT DISTINCT je.value AS "name"
  FROM "Task" t, json_each(t."tagsJson") je
  WHERE json_valid(t."tagsJson") AND t."tagsJson" != '[]'
);

INSERT OR IGNORE INTO "TaskTag" ("taskId", "tagId")
SELECT t."id", (SELECT "id" FROM "Tag" WHERE "name" = je.value)
FROM "Task" t, json_each(t."tagsJson") je
WHERE json_valid(t."tagsJson") AND t."tagsJson" != '[]';
