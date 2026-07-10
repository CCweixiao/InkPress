import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  readContentAt,
  contentExistsAt,
  writeContentAt,
  articleFilePath,
} from "@/lib/content-store";
import { withApiLog, logMutation } from "@/lib/api-log";
import { TITLE_REGEX } from "@/lib/validation";
import { ARTICLE_TYPE_PROFILES } from "@/lib/ai/article-type-profile";

const updateSchema = z.object({
  title: z
    .string()
    .max(200)
    .regex(TITLE_REGEX, "标题包含不支持的字符")
    .optional(),
  contentMd: z.string().optional(),
  digest: z.string().max(200).optional(),
  coverMediaId: z.string().nullable().optional(),
  coverAssetId: z.string().nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  themeId: z.string().nullable().optional(),
  spaceId: z.string().nullable().optional(),
  profileId: z.string().nullable().optional(),
  status: z.enum(["draft", "ready", "pushed"]).optional(),
  wxMediaId: z.string().nullable().optional(),
  expectedContentRevision: z.number().int().nonnegative().optional(),
});

type Params = { params: Promise<{ id: string }> };

// 文件是正文真相源，故在同一进程内让同一文章的 CAS claim 和原子文件写串行。
// 数据库 revision 仍是跨请求/跨进程的最终仲裁；写失败只在 claim 未被后续写入
// 推进时回滚，绝不写回旧正文覆盖成功的并发更新。
const contentWriteTails = new Map<string, Promise<void>>();
async function withContentWriteLock<T>(id: string, operation: () => Promise<T>) {
  const previous = contentWriteTails.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  contentWriteTails.set(id, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (contentWriteTails.get(id) === tail) contentWriteTails.delete(id);
  }
}

function revisionConflict() {
  return NextResponse.json(
    { error: "文章已被其他修改更新，请刷新后重试。", code: "revision-conflict" },
    { status: 409 }
  );
}

// 获取单篇（正文从文件读取，注入 contentMd 字段以保持契约）
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const article = await prisma.article.findUnique({
    where: { id },
    include: { theme: true },
  });
  if (!article) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const fallbackPath = articleFilePath({ articleId: article.id, spaceId: article.spaceId });
  const contentMd = article.contentPath
    ? await readContentAt(article.contentPath)
    : (await contentExistsAt(fallbackPath)) ? await readContentAt(fallbackPath) : (article.contentMd ?? "");
  return NextResponse.json({ article: { ...article, contentMd } });
}

// 更新文章（编辑器自动保存、发布、sendBeacon 卸载保存共用）
async function updateArticle(id: string, req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (
    parsed.data.profileId &&
    !Object.prototype.hasOwnProperty.call(
      ARTICLE_TYPE_PROFILES,
      parsed.data.profileId
    )
  ) {
    return NextResponse.json({ error: "文章类型无效。" }, { status: 400 });
  }
  // 正文写文件，不落库（contentMd 列仅作兼容）
  const { contentMd, expectedContentRevision, ...rest } = parsed.data;
  if (typeof contentMd === "string") {
    return withContentWriteLock(id, async () => {
      // contentPath 为正文位置的唯一真相源；缺失时按 spaceId 算出并随 claim 回写。
      const existing = await prisma.article.findUnique({ where: { id } });
      if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
      const revision = existing.contentRevision;
      if (expectedContentRevision !== undefined && expectedContentRevision !== revision) {
        return revisionConflict();
      }
      const rel = existing.contentPath ?? articleFilePath({ articleId: id, spaceId: existing.spaceId });
      const claimed = await prisma.article.updateMany({
        where: { id, contentRevision: revision },
        data: {
          contentRevision: { increment: 1 },
          ...(existing.contentPath ? {} : { contentPath: rel }),
        },
      });
      if (claimed.count !== 1) return revisionConflict();
      let contentWritten = false;
      try {
        await writeContentAt(rel, contentMd);
        contentWritten = true;
        const article = await prisma.article.update({ where: { id }, data: rest });
        return NextResponse.json({ article: { ...article, contentMd } });
      } catch (error) {
        // Once the atomic file write succeeds, retain the revision claim: rolling
        // it back would let a stale writer overwrite that newly persisted body.
        if (!contentWritten) {
          await prisma.article.updateMany({
            where: { id, contentRevision: revision + 1 },
            data: {
              contentRevision: revision,
              ...(existing.contentPath ? {} : { contentPath: null }),
            },
          }).catch(() => {});
        }
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "保存文章正文失败。" },
          { status: 500 }
        );
      }
    });
  }
  // Title/digest participate in articleVersionHash used by proposals.  Advance
  // the same revision even without a body write so a proposal cannot apply a
  // metadata base that changed after its hash check.
  if (Object.hasOwn(rest, "title") || Object.hasOwn(rest, "digest")) {
    const existing = await prisma.article.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (expectedContentRevision !== undefined && expectedContentRevision !== existing.contentRevision) {
      return revisionConflict();
    }
    const updated = await prisma.article.updateMany({
      where: { id, contentRevision: existing.contentRevision },
      data: { ...rest, contentRevision: { increment: 1 } },
    });
    if (updated.count !== 1) return revisionConflict();
    const article = await prisma.article.findUnique({ where: { id } });
    return NextResponse.json({ article });
  }
  const article = await prisma.article.update({
    where: { id },
    data: rest,
  });
  return NextResponse.json({ article });
}

// PUT 更新（编辑器自动保存等）
export const PUT = withApiLog("PUT /api/articles/[id]", async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const res = await updateArticle(id, req);
  logMutation("article", "update", { id });
  return res;
});

// POST 更新（页面卸载时 sendBeacon 只能发 POST，此处复用更新逻辑）
export const POST = withApiLog("POST /api/articles/[id]", async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const res = await updateArticle(id, req);
  logMutation("article", "update", { id, beacon: true });
  return res;
});

// 软删除（移入回收站，30 天后过期）
export const DELETE = withApiLog("DELETE /api/articles/[id]", async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await prisma.article.update({
    where: { id },
    data: { trashed: true, trashedAt: now, expiresAt },
  });
  // 关联素材一并软删
  await prisma.asset.updateMany({
    where: { articleId: id, trashed: false },
    data: { trashed: true, trashedAt: now, expiresAt },
  });
  logMutation("article", "trash", { id });
  return NextResponse.json({ ok: true });
});
