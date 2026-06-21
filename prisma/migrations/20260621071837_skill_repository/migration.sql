-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "manual" TEXT NOT NULL DEFAULT '',
    "promptHint" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_skillKey_key" ON "Skill"("skillKey");

-- CreateIndex
CREATE INDEX "Skill_createdAt_idx" ON "Skill"("createdAt");
