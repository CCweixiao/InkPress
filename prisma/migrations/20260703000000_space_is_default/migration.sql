-- AlterTable: Space 新增 isDefault（默认空间标识，不可编辑/删除，至多一个）
ALTER TABLE "Space" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
