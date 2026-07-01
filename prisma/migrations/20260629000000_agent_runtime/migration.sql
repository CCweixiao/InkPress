-- Agent Runtime：标记会话使用的 Agent runtime，并保存 Claude Agent SDK 会话句柄。
ALTER TABLE "AgentChatSession" ADD COLUMN "runtime" TEXT NOT NULL DEFAULT 'claude-agent';
ALTER TABLE "AgentChatSession" ADD COLUMN "claudeAgentSessionId" TEXT;
ALTER TABLE "AgentChatSession" ADD COLUMN "claudeAgentStoreKey" TEXT;
