import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readContentAt } from "@/lib/content-store";
import { articleVersionHash } from "@/lib/ai/article-version";

type Params = { params: Promise<{ id: string }> };
const schema = z.object({ status: z.literal("rejected") });

function changeStats(oldText: string, newText: string) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  let changed = 0;
  for (let index = 0; index < Math.max(oldLines.length, newLines.length); index++) {
    if (oldLines[index] !== newLines[index]) changed++;
  }
  return {
    oldLines: oldLines.length,
    newLines: newLines.length,
    changedLines: changed,
  };
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  let articleProposal = await prisma.agentArticleProposal.findUnique({
    where: { id },
    include: { article: true },
  });
  if (articleProposal) {
    if (
      articleProposal.baseMarkdown === "" &&
      articleProposal.status === "pending"
    ) {
      const currentMarkdown = articleProposal.article.contentPath
        ? await readContentAt(articleProposal.article.contentPath)
        : articleProposal.article.contentMd;
      const currentHash = articleVersionHash({
        title: articleProposal.article.title,
        markdown: currentMarkdown,
        digest: articleProposal.article.digest,
      });
      if (currentHash === articleProposal.baseVersionHash) {
        articleProposal = await prisma.agentArticleProposal.update({
          where: { id },
          data: {
            baseTitle: articleProposal.article.title,
            baseMarkdown: currentMarkdown,
            baseDigest: articleProposal.article.digest ?? "",
          },
          include: { article: true },
        });
      }
    }
    return NextResponse.json({
      proposal: {
        id: articleProposal.id,
        proposalKind: "article",
        targetId: articleProposal.articleId,
        baseTitle: articleProposal.baseTitle,
        baseMarkdown: articleProposal.baseMarkdown,
        baseDigest: articleProposal.baseDigest,
        title: articleProposal.title,
        markdown: articleProposal.markdown,
        digest: articleProposal.digest,
        summary: articleProposal.summary,
        status: articleProposal.status,
        createdAt: articleProposal.createdAt,
        decidedAt: articleProposal.decidedAt,
        stats: changeStats(
          articleProposal.baseMarkdown,
          articleProposal.markdown
        ),
      },
    });
  }

  return NextResponse.json({ error: "提案不存在。" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "仅支持放弃待处理提案。" }, { status: 400 });
  }
  const article = await prisma.agentArticleProposal.updateMany({
    where: { id, status: "pending" },
    data: { status: "rejected", decidedAt: new Date() },
  });
  if (article.count === 1) {
    return NextResponse.json({ ok: true, status: "rejected" });
  }
  const existingArticle = await prisma.agentArticleProposal.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existingArticle) {
    return NextResponse.json({ error: "提案不存在。" }, { status: 404 });
  }
  return NextResponse.json(
    { error: "该提案已被其他操作处理。", status: existingArticle.status },
    { status: 409 }
  );
}
