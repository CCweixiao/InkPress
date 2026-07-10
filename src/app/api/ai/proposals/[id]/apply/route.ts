import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  readContentAt,
  writeContentAt,
  readTechnicalDocumentContent,
  writeTechnicalDocumentContent,
  articleFilePath,
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
  // 正文位置：以 contentPath 为唯一真相源，缺失时按 spaceId 计算（与读取保持一致）
  const articleRel =
    proposal.article.contentPath ??
    articleFilePath({
      articleId: proposal.articleId,
      spaceId: proposal.article.spaceId,
    });
  const fileMarkdown = await readContentAt(articleRel);
  // Pre-contentPath articles may already have a migrated file. Prefer it when
  // present, and retain contentMd only as the compatibility fallback.
  const currentMarkdown = proposal.article.contentPath
    ? fileMarkdown
    : fileMarkdown || proposal.article.contentMd;
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

  // 先在 DB 中以 article revision 和 pending proposal 一并 claim，再写文件。
  // 这样两个基于同一正文生成的 proposal 即使同时通过 hash 校验，也只能有一个
  // 推进正文版本。文件写失败时仅回滚仍属于本次 claim 的 revision，避免覆盖后来者。
  const revision = proposal.article.contentRevision;
  const claimed = await prisma.$transaction(async (tx) => {
    const articleClaim = await tx.article.updateMany({
      where: { id: proposal.articleId, contentRevision: revision },
      data: {
        contentRevision: { increment: 1 },
        ...(proposal.title !== null ? { title: proposal.title } : {}),
        ...(proposal.digest !== null ? { digest: proposal.digest } : {}),
        ...(proposal.article.contentPath ? {} : { contentPath: articleRel }),
      },
    });
    if (articleClaim.count !== 1) return false;
    const proposalClaim = await tx.agentArticleProposal.updateMany({
      where: { id, status: "pending" },
      data: { status: "applying" },
    });
    if (proposalClaim.count !== 1) throw new Error("proposal-claim-failed");
    return true;
  }).catch(async (error) => {
    if (error instanceof Error && error.message === "proposal-claim-failed") return false;
    throw error;
  });
  if (!claimed) {
    await prisma.agentArticleProposal.updateMany({
      where: { id, status: "pending" },
      data: { status: "superseded", decidedAt: new Date() },
    });
    return NextResponse.json(
      { error: "文章已被其他修改更新，该提案已失效。", status: "superseded" },
      { status: 409 }
    );
  }
  let contentWritten = false;
  try {
    await writeContentAt(articleRel, targetMarkdown);
    contentWritten = true;
    const article = await prisma.$transaction(async (tx) => {
      const updated = await tx.article.findUniqueOrThrow({
        where: { id: proposal.articleId },
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
    // 不写回 currentMarkdown：其他成功 claim 可能已经写入了更新的正文。
    // 一旦原子文件写成功，保留 revision claim（即使后续状态更新失败）以免下一次
    // 写入把已成功落盘的正文当作旧版本覆盖。
    if (!contentWritten) {
      await prisma.article.updateMany({
        where: { id: proposal.articleId, contentRevision: revision + 1 },
        data: {
          contentRevision: revision,
          ...(proposal.article.contentPath ? {} : { contentPath: null }),
        },
      }).catch(() => {});
      await prisma.agentArticleProposal.updateMany({
        where: { id, status: "applying" },
        data: { status: "pending" },
      });
    }
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
