ALTER TABLE "AgentChatSession" ADD COLUMN "summaryUpToPosition" INTEGER NOT NULL DEFAULT -1;
ALTER TABLE "AgentChatSession" ADD COLUMN "lastInputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentChatSession" ADD COLUMN "lastOutputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentChatSession" ADD COLUMN "lastReasoningTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentChatSession" ADD COLUMN "lastTotalTokens" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "AgentArticleProposal" ADD COLUMN "baseTitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AgentArticleProposal" ADD COLUMN "baseMarkdown" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AgentArticleProposal" ADD COLUMN "baseDigest" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AgentArticleProposal" ADD COLUMN "decidedAt" DATETIME;

UPDATE "AgentArticleProposal"
SET "baseTitle" = COALESCE((SELECT "title" FROM "Article" WHERE "Article"."id" = "AgentArticleProposal"."articleId"), ''),
    "baseDigest" = COALESCE((SELECT "digest" FROM "Article" WHERE "Article"."id" = "AgentArticleProposal"."articleId"), '')
WHERE "baseTitle" = '' AND "baseDigest" = '';
