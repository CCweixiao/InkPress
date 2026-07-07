-- P1（claude-agent-session PDC §6.2/§7.4）：ClaudeAgentSessionEntry 加保序与排障字段。
-- SQLite ADD COLUMN：可空列无默认值；updatedAt 用 NOT NULL DEFAULT CURRENT_TIMESTAMP 回填旧行。
-- appendSeq/entryType/entryTimestamp 可空——迁移前的旧行无值，load() 按 appendSeq(nulls first) + createdAt 兜底排序。

-- Append-ordering columns
ALTER TABLE "ClaudeAgentSessionEntry" ADD COLUMN "appendSeq" INTEGER;
ALTER TABLE "ClaudeAgentSessionEntry" ADD COLUMN "entryType" TEXT;
ALTER TABLE "ClaudeAgentSessionEntry" ADD COLUMN "entryTimestamp" DATETIME;
-- updatedAt：SQLite 的 ADD COLUMN 不允许非常量默认（CURRENT_TIMESTAMP），故先加可空列再 UPDATE 回填。
-- WHERE IS NULL 使该步幂等（重放不覆盖已写入值）。
ALTER TABLE "ClaudeAgentSessionEntry" ADD COLUMN "updatedAt" DATETIME;
UPDATE "ClaudeAgentSessionEntry" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;

-- Stable load() ordering + entryType 排障索引
CREATE INDEX "ClaudeAgentSessionEntry_projectKey_sdkSessionId_subpath_appendSeq_idx"
    ON "ClaudeAgentSessionEntry"("projectKey", "sdkSessionId", "subpath", "appendSeq");
CREATE INDEX "ClaudeAgentSessionEntry_entryType_idx"
    ON "ClaudeAgentSessionEntry"("entryType");
