-- Add optional Article profile id for P3 ArticleTypeProfile prompt/skill defaults.
ALTER TABLE "Article" ADD COLUMN "profileId" TEXT;
