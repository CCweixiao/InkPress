-- P2（claude-agent-session PDC §6.1）：AgentChatSession 增加 Claude SDK 会话健康状态字段。
-- claudeAgentSessionStatus 用 NOT NULL DEFAULT 'none'：SQLite 对 ADD COLUMN 会把既有行回填为 'none'，
-- 新行不指定时也落 'none' → 状态机列恒为合法枚举（none|running|ready|interrupted|error|cleared）。
-- 其余时间戳/错误列为可空（事件发生前确实没有值）。与 usage ledger（AgentUsageTurn）完全独立：
-- 清聊天/清 SDK session 不影响历史消耗统计。

ALTER TABLE "AgentChatSession" ADD COLUMN "claudeAgentSessionStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "AgentChatSession" ADD COLUMN "claudeAgentLastEventAt" DATETIME;
ALTER TABLE "AgentChatSession" ADD COLUMN "claudeAgentLastError" TEXT;
ALTER TABLE "AgentChatSession" ADD COLUMN "claudeAgentInterruptedAt" DATETIME;
ALTER TABLE "AgentChatSession" ADD COLUMN "claudeAgentResumeCount" INTEGER NOT NULL DEFAULT 0;
