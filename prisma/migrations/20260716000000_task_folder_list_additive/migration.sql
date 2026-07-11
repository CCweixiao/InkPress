-- CreateTable TaskFolder
CREATE TABLE "TaskFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable TaskList
CREATE TABLE "TaskList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "folderId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskList_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "TaskFolder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 种子默认清单（固定 id，便于回填 listId）
INSERT INTO "TaskList" ("id", "name", "color", "folderId", "sortOrder", "createdAt", "updatedAt")
VALUES ('cl_default_list_seed_fixed', '默认清单', '#6b7280', NULL, 0, datetime('now'), datetime('now'));

-- 给 Task 加 listId 列（先可空）
ALTER TABLE "Task" ADD COLUMN "listId" TEXT;

-- 回填：所有 listId 为空的指向默认清单
UPDATE "Task" SET "listId" = 'cl_default_list_seed_fixed' WHERE "listId" IS NULL;

-- 索引
CREATE INDEX "TaskFolder_sortOrder_idx" ON "TaskFolder"("sortOrder");
CREATE INDEX "TaskList_folderId_idx" ON "TaskList"("folderId");
CREATE INDEX "TaskList_sortOrder_idx" ON "TaskList"("sortOrder");
CREATE INDEX "Task_listId_status_sortOrder_idx" ON "Task"("listId", "status", "sortOrder");
