-- Snippet.expiresAt：与 Article/Space/Asset 对齐的回收站过期时间
ALTER TABLE "Snippet" ADD COLUMN "expiresAt" DATETIME;

-- 回填既有已删灵感：以删除时刻起算 30 天过期（与新增删除路径 now+30d 语义一致）
UPDATE "Snippet"
SET "expiresAt" = datetime("trashedAt", '+30 days')
WHERE "trashed" = 1 AND "expiresAt" IS NULL AND "trashedAt" IS NOT NULL;
