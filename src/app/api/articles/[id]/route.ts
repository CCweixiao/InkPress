import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readContent, writeContent } from "@/lib/content-store";
import { withApiLog, logMutation } from "@/lib/api-log";

const updateSchema = z.object({
  title: z.string().max(200).optional(),
  contentMd: z.string().optional(),
  digest: z.string().max(200).optional(),
  coverMediaId: z.string().nullable().optional(),
  coverAssetId: z.string().nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  themeId: z.string().nullable().optional(),
  spaceId: z.string().nullable().optional(),
  status: z.enum(["draft", "ready", "pushed"]).optional(),
  wxMediaId: z.string().nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

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
  const contentMd = article.contentPath
    ? await readContent(article.id)
    : (article.contentMd ?? "");
  return NextResponse.json({ article: { ...article, contentMd } });
}

// 更新文章（编辑器自动保存、发布、sendBeacon 卸载保存共用）
async function updateArticle(id: string, req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // 正文写文件，不落库（contentMd 列仅作兼容）
  const { contentMd, ...rest } = parsed.data;
  if (typeof contentMd === "string") {
    await writeContent(id, contentMd);
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
