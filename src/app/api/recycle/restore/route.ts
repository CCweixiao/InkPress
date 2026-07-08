import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApiLog, logMutation } from "@/lib/api-log";

export const runtime = "nodejs";

const schema = z.object({
  type: z.enum(["article", "space", "asset", "snippet"]),
  id: z.string().min(1),
});

/** 恢复回收站项：清除 trashed 标记。
 * 文章恢复时若其所属空间仍在回收站，则提示先恢复空间。 */
export const POST = withApiLog("POST /api/recycle/restore", async (req: Request) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }
  const { type, id } = parsed.data;

  if (type === "article") {
    const article = await prisma.article.findUnique({ where: { id } });
    if (!article) return NextResponse.json({ error: "不存在" }, { status: 404 });
    if (article.spaceId) {
      const space = await prisma.space.findUnique({
        where: { id: article.spaceId },
      });
      if (space?.trashed) {
        return NextResponse.json(
          { error: "该文章所属空间也在回收站，请先恢复对应空间。" },
          { status: 400 }
        );
      }
    }
    await prisma.article.update({
      where: { id },
      data: { trashed: false, trashedAt: null, expiresAt: null },
    });
    // 一并恢复其关联素材
    await prisma.asset.updateMany({
      where: { articleId: id },
      data: { trashed: false, trashedAt: null, expiresAt: null },
    });
    logMutation("recycle", "restore", { type, id });
    return NextResponse.json({ ok: true });
  }

  if (type === "space") {
    await prisma.space.update({
      where: { id },
      data: { trashed: false, trashedAt: null, expiresAt: null },
    });
    await prisma.asset.updateMany({
      where: { spaceId: id },
      data: { trashed: false, trashedAt: null, expiresAt: null },
    });
    logMutation("recycle", "restore", { type, id });
    return NextResponse.json({ ok: true });
  }

  if (type === "snippet") {
    await prisma.snippet.update({
      where: { id },
      data: { trashed: false, trashedAt: null, expiresAt: null },
    });
    logMutation("recycle", "restore", { type, id });
    return NextResponse.json({ ok: true });
  }

  // asset
  await prisma.asset.update({
    where: { id },
    data: { trashed: false, trashedAt: null, expiresAt: null },
  });
  logMutation("recycle", "restore", { type, id });
  return NextResponse.json({ ok: true });
});
