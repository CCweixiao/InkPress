import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  readContent,
  readTechnicalDocumentContent,
  writeContent,
  writeTechnicalDocumentContent,
} from "@/lib/content-store";
import { articleVersionHash } from "@/lib/ai/article-version";

type Params = { params: Promise<{ id: string }> };

async function applyArticle(id: string, overrideMarkdown?: string) {
  const proposal = await prisma.agentArticleProposal.findUnique({
    where: { id },
    include: { article: true },
  });
  if (!proposal) return null;
  const targetMarkdown = overrideMarkdown ?? proposal.markdown;
  if (proposal.status !== "pending") {
    return NextResponse.json(
      { error: "该提案已处理。", status: proposal.status },
      { status: 409 }
    );
  }
  const currentMarkdown = proposal.article.contentPath
    ? await readContent(proposal.article.id)
    : proposal.article.contentMd;
  const currentHash = articleVersionHash({
    title: proposal.article.title,
    markdown: currentMarkdown,
    digest: proposal.article.digest,
  });
  if (currentHash !== proposal.baseVersionHash) {
    await prisma.agentArticleProposal.updateMany({
      where: { id, status: "pending" },
      data: { status: "superseded", decidedAt: new Date() },
    });
    return NextResponse.json(
      { error: "文章在提案生成后已发生变化，该提案已失效。", status: "superseded" },
      { status: 409 }
    );
  }

  const claimed = await prisma.agentArticleProposal.updateMany({
    where: { id, status: "pending" },
    data: { status: "applying" },
  });
  if (claimed.count !== 1) {
    return NextResponse.json(
      { error: "该提案已被其他操作处理。", status: "applying" },
      { status: 409 }
    );
  }
  try {
    await writeContent(proposal.articleId, targetMarkdown);
    const article = await prisma.$transaction(async (tx) => {
      const updated = await tx.article.update({
        where: { id: proposal.articleId },
        data: {
          ...(proposal.title !== null ? { title: proposal.title } : {}),
          ...(proposal.digest !== null ? { digest: proposal.digest } : {}),
        },
      });
      await tx.agentArticleProposal.update({
        where: { id },
        data: {
          markdown: targetMarkdown,
          status: "applied",
          appliedAt: new Date(),
          decidedAt: new Date(),
        },
      });
      await tx.agentArticleProposal.updateMany({
        where: {
          articleId: proposal.articleId,
          baseVersionHash: proposal.baseVersionHash,
          status: "pending",
          id: { not: id },
        },
        data: { status: "superseded", decidedAt: new Date() },
      });
      return updated;
    });
    return NextResponse.json({
      ok: true,
      status: "applied",
      proposalKind: "article",
      article: { ...article, contentMd: targetMarkdown },
    });
  } catch (error) {
    await writeContent(proposal.articleId, currentMarkdown).catch(() => {});
    await prisma.agentArticleProposal.updateMany({
      where: { id, status: "applying" },
      data: { status: "pending" },
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "应用文章提案失败。" },
      { status: 500 }
    );
  }
}

async function applyTechnicalDocument(id: string) {
  const proposal = await prisma.agentTechnicalDocumentProposal.findUnique({
    where: { id },
    include: { technicalDocument: true },
  });
  if (!proposal) return null;
  if (proposal.status !== "pending") {
    return NextResponse.json(
      { error: "该提案已处理。", status: proposal.status },
      { status: 409 }
    );
  }
  const currentMarkdown = proposal.technicalDocument.contentPath
    ? await readTechnicalDocumentContent(proposal.technicalDocumentId)
    : "";
  const currentHash = articleVersionHash({
    title: proposal.technicalDocument.title,
    markdown: currentMarkdown,
    digest: proposal.technicalDocument.snapshotHash,
  });
  if (currentHash !== proposal.baseVersionHash) {
    await prisma.agentTechnicalDocumentProposal.updateMany({
      where: { id, status: "pending" },
      data: { status: "superseded", decidedAt: new Date() },
    });
    return NextResponse.json(
      { error: "技术文档在提案生成后已发生变化，该提案已失效。", status: "superseded" },
      { status: 409 }
    );
  }

  const claimed = await prisma.agentTechnicalDocumentProposal.updateMany({
    where: { id, status: "pending" },
    data: { status: "applying" },
  });
  if (claimed.count !== 1) {
    return NextResponse.json(
      { error: "该提案已被其他操作处理。", status: "applying" },
      { status: 409 }
    );
  }
  try {
    await writeTechnicalDocumentContent(
      proposal.technicalDocumentId,
      proposal.markdown
    );
    const document = await prisma.$transaction(async (tx) => {
      const latest = await tx.technicalDocumentVersion.aggregate({
        where: { technicalDocumentId: proposal.technicalDocumentId },
        _max: { version: true },
      });
      const updated = await tx.technicalDocument.update({
        where: { id: proposal.technicalDocumentId },
        data: {
          ...(proposal.title !== null ? { title: proposal.title } : {}),
          snapshotHash:
            proposal.snapshotHash ?? proposal.technicalDocument.snapshotHash,
          codeSourceJson: (() => {
            try {
              const snapshot = JSON.parse(proposal.sourceSnapshotJson) as {
                codeSource?: unknown;
              };
              return snapshot.codeSource
                ? JSON.stringify(snapshot.codeSource)
                : proposal.technicalDocument.codeSourceJson;
            } catch {
              return proposal.technicalDocument.codeSourceJson;
            }
          })(),
        },
      });
      await tx.technicalDocumentVersion.create({
        data: {
          technicalDocumentId: proposal.technicalDocumentId,
          version: (latest._max.version ?? 0) + 1,
          title: proposal.title ?? proposal.technicalDocument.title,
          markdown: proposal.markdown,
          snapshotHash:
            proposal.snapshotHash ?? proposal.technicalDocument.snapshotHash,
          sourceSnapshotJson: proposal.sourceSnapshotJson,
        },
      });
      await tx.agentTechnicalDocumentProposal.update({
        where: { id },
        data: { status: "applied", appliedAt: new Date(), decidedAt: new Date() },
      });
      await tx.agentTechnicalDocumentProposal.updateMany({
        where: {
          technicalDocumentId: proposal.technicalDocumentId,
          baseVersionHash: proposal.baseVersionHash,
          status: "pending",
          id: { not: id },
        },
        data: { status: "superseded", decidedAt: new Date() },
      });
      return updated;
    });
    return NextResponse.json({
      ok: true,
      status: "applied",
      proposalKind: "technical-document",
      technicalDocument: { ...document, markdown: proposal.markdown },
    });
  } catch (error) {
    await writeTechnicalDocumentContent(
      proposal.technicalDocumentId,
      currentMarkdown
    ).catch(() => {});
    await prisma.agentTechnicalDocumentProposal.updateMany({
      where: { id, status: "applying" },
      data: { status: "pending" },
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "应用技术文档提案失败。",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    markdown?: unknown;
  };
  const overrideMarkdown =
    typeof body.markdown === "string" ? body.markdown : undefined;
  return (
    (await applyArticle(id, overrideMarkdown)) ??
    (await applyTechnicalDocument(id)) ??
    NextResponse.json({ error: "修改提案不存在。" }, { status: 404 })
  );
}
