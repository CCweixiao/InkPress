-- AlterTable: Article 新增 coverUrl（封面可访问 URL，列表展示直接读）
ALTER TABLE "Article" ADD COLUMN "coverUrl" TEXT;

-- AlterTable: Theme 新增 isDefault（默认主题标识，至多一个为 true，由应用层事务保证）
ALTER TABLE "Theme" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
