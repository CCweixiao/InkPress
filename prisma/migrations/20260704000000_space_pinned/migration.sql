-- AlterTable: Space 新增 pinned（置顶标识，排序优先级：默认 > 置顶 > createdAt 倒序）
ALTER TABLE "Space" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
