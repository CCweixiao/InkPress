-- AlterTable: 新增资源清单列（压缩包上传时填充）
ALTER TABLE "Skill" ADD COLUMN "manifest" TEXT;
ALTER TABLE "Skill" ADD COLUMN "hasResources" BOOLEAN NOT NULL DEFAULT false;
