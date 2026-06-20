-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT '',
    "contentMd" TEXT NOT NULL DEFAULT '',
    "digest" TEXT,
    "coverMediaId" TEXT,
    "themeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "wxMediaId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Article_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "cssContent" TEXT NOT NULL,
    "codeTheme" TEXT NOT NULL DEFAULT 'atom-one-dark',
    "primaryColor" TEXT DEFAULT '#3f51b5',
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceUrl" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "wxUrl" TEXT,
    "wxMediaId" TEXT,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Article_themeId_idx" ON "Article"("themeId");

-- CreateIndex
CREATE UNIQUE INDEX "Material_sourceHash_key" ON "Material"("sourceHash");
