import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  readContentAt,
  contentExistsAt,
  writeContentAt,
  articleFilePath,
  withArticleContentWriteLock,
} from "@/lib/content-store";
import { articleVersionHash } from "@/lib/ai/article-version";
import { moduleLogger } from "@/lib/logger";
import { withApiLog } from "@/lib/api-log";

type Params = { params: Promise<{ id: string }> };
const log = moduleLogger("article-proposal-apply");
const FINALIZE_RETRY_DELAYS_MS = [0, 80, 240] as const;

type LoadedProposal = Prisma.AgentArticleProposalGetPayload<{
  include: { article: true };
}>;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function finalizeAppliedProposal(
  proposal: LoadedProposal,
  targetMarkdown: string
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < FINALIZE_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = FINALIZE_RETRY_DELAYS_MS[attempt];
    if (delayMs) await sleep(delayMs);
    try {
      const article = await prisma.$transaction(async (tx) => {
        // 正文 claim 已经推进过 revision。此处不能再要求 revision === claim+1：
        // 摘要/标题保存可以在文件写入期间合法推进 revision，但不影响正文落盘结果。
        const metadataUpdated = await tx.article.updateMany({
          where: { id: proposal.articleId },
          data: {
            ...(proposal.title !== null ? { title: proposal.title } : {}),
            ...(proposal.digest !== null ? { digest: proposal.digest } : {}),
          },
        });
        if (metadataUpdated.count !== 1) throw new Error("article-not-found-during-finalize");
        const updated = await tx.article.findUniqueOrThrow({ where: { id: proposal.articleId } });
        await tx.agentArticleProposal.update({
          where: { id: proposal.id },
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
            id: { not: proposal.id },
          },
          data: { status: "superseded", decidedAt: new Date() },
        });
        return updated;
      });
      if (attempt > 0) {
        log.info(
          { proposalId: proposal.id, articleId: proposal.articleId, attempt: attempt + 1 },
          "文章提案收尾重试成功"
        );
      }
      return article;
    } catch (error) {
      lastError = error;
      log.warn(
        {
          err: error,
          proposalId: proposal.id,
          articleId: proposal.articleId,
          attempt: attempt + 1,
          maxAttempts: FINALIZE_RETRY_DELAYS_MS.length,
        },
        "文章提案收尾失败，准备重试"
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("article-finalize-failed");
}

function appliedResponse(
  article: Awaited<ReturnType<typeof finalizeAppliedProposal>>,
  targetMarkdown: string,
  extra: Record<string, unknown> = {}
) {
  return NextResponse.json({
    ok: true,
    status: "applied",
    proposalKind: "article",
    article: { ...article, contentMd: targetMarkdown },
    ...extra,
  });
}

async function applyArticleLocked(id: string, overrideMarkdown?: string) {
  const proposal = await prisma.agentArticleProposal.findUnique({
    where: { id },
    include: { article: true },
  });
  if (!proposal) return null;
  const targetMarkdown = overrideMarkdown ?? proposal.markdown;
  if (!["pending", "applying", "error", "applied"].includes(proposal.status)) {
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
  const currentMarkdown = proposal.article.contentPath || await contentExistsAt(articleRel)
    ? fileMarkdown
    : proposal.article.contentMd;

  // 双击、客户端超时重试或页面恢复：applied 直接返回当前结果，不重复写正文。
  if (proposal.status === "applied") {
    log.info(
      { proposalId: id, articleId: proposal.articleId },
      "文章提案幂等命中已应用状态"
    );
    return appliedResponse(proposal.article, currentMarkdown, { idempotent: true });
  }

  // 进程中断或旧版本的 article-finalize-failed 会留下 applying/error，但正文已经落盘。
  // 文件内容吻合时只恢复数据库状态，不再次 claim revision 或重写正文。
  if (proposal.status === "applying" || proposal.status === "error") {
    if (currentMarkdown !== targetMarkdown) {
      return NextResponse.json(
        {
          error: "提案状态异常，且当前正文与待恢复内容不一致，已停止自动恢复。",
          code: "article-recovery-content-mismatch",
          status: proposal.status,
          recoverable: false,
        },
        { status: 409 }
      );
    }
    try {
      const article = await finalizeAppliedProposal(proposal, targetMarkdown);
      log.info(
        { proposalId: id, articleId: proposal.articleId, previousStatus: proposal.status },
        "文章提案半成功状态已恢复"
      );
      return appliedResponse(article, targetMarkdown, {
        idempotent: true,
        recovered: true,
      });
    } catch (error) {
      log.error(
        { err: error, proposalId: id, articleId: proposal.articleId },
        "文章提案半成功状态恢复失败"
      );
      return NextResponse.json(
        {
          error: "正文已写入，但状态同步仍失败，请稍后点击“重试同步”。",
          code: "article-finalize-failed",
          status: "error",
          contentApplied: true,
          recoverable: true,
        },
        { status: 500 }
      );
    }
  }

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
    log.info(
      { proposalId: id, articleId: proposal.articleId, revision },
      "开始写入文章提案正文"
    );
    await writeContentAt(articleRel, targetMarkdown);
    contentWritten = true;
    const persistedMarkdown = await readContentAt(articleRel);
    if (persistedMarkdown !== targetMarkdown) {
      throw new Error("article-content-verification-failed");
    }
    const article = await finalizeAppliedProposal(proposal, targetMarkdown);
    log.info(
      { proposalId: id, articleId: proposal.articleId, revision: article.contentRevision },
      "文章提案应用成功"
    );
    return appliedResponse(article, targetMarkdown);
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
    if (contentWritten) {
      await prisma.agentArticleProposal.updateMany({
        where: { id, status: "applying" },
        data: { status: "error", decidedAt: new Date() },
      }).catch(() => {});
      log.error(
        {
          err: error,
          proposalId: id,
          articleId: proposal.articleId,
          revision,
          contentApplied: true,
          recoverable: true,
        },
        "文章正文已写入，但提案状态收尾失败"
      );
    }
    return NextResponse.json(
      contentWritten
        ? {
            error: "正文已写入，但状态同步失败，请点击“重试同步”。",
            code: "article-finalize-failed",
            status: "error",
            contentApplied: true,
            recoverable: true,
          }
        : {
            error: error instanceof Error ? error.message : "应用文章提案失败。",
            code: "article-write-failed",
            status: "pending",
            contentApplied: false,
            recoverable: true,
          },
      { status: 500 }
    );
  }
}

async function applyArticle(id: string, overrideMarkdown?: string) {
  const proposal = await prisma.agentArticleProposal.findUnique({
    where: { id },
    select: { articleId: true },
  });
  if (!proposal) return null;
  return withArticleContentWriteLock(proposal.articleId, () =>
    applyArticleLocked(id, overrideMarkdown)
  );
}

async function postProposalApply(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    markdown?: unknown;
  };
  const overrideMarkdown =
    typeof body.markdown === "string" ? body.markdown : undefined;
  return (
    (await applyArticle(id, overrideMarkdown)) ??
    NextResponse.json({ error: "修改提案不存在。" }, { status: 404 })
  );
}

export const POST = withApiLog("POST /api/ai/proposals/[id]/apply", postProposalApply);
