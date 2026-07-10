ALTER TABLE "AgentChatSession" ADD COLUMN "activeTurnId" TEXT;
ALTER TABLE "AgentChatSession" ADD COLUMN "activeTurnExpiresAt" DATETIME;

CREATE INDEX "AgentChatSession_activeTurnExpiresAt_idx" ON "AgentChatSession"("activeTurnExpiresAt");
