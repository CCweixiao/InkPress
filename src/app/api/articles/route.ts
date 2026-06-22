import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeContent, relativePath } from "@/lib/content-store";
import { withApiLog, logMutation } from "@/lib/api-log";

const createSchema = z.object({
  title: z.string().max(200).optional(),
  themeId: z.string().optional(),
  spaceId: z.string().nullable().optional(),
});

// 列出全部文章（按更新时间倒序，排除回收站）
export async function GET() {
  const articles = await prisma.article.findMany({
    where: { trashed: false },
    orderBy: { updatedAt: "desc" },
    include: { theme: { select: { name: true } } },
  });
  return NextResponse.json({ articles });
}

// 新建文章
export const POST = withApiLog("POST /api/articles", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // 先创建拿 id，再落盘正文文件
  // 未指定主题时取默认主题（isDefault），再回落第一个内置主题
  let themeId = parsed.data.themeId ?? null;
  if (!themeId) {
    const defaultTheme =
      (await prisma.theme.findFirst({ where: { isDefault: true } })) ??
      (await prisma.theme.findFirst({ where: { isBuiltIn: true } }));
    themeId = defaultTheme?.id ?? null;
  }
  const article = await prisma.article.create({
    data: {
      title: parsed.data.title ?? "无标题文章",
      themeId,
      spaceId: parsed.data.spaceId ?? null,
    },
  });
  await writeContent(article.id, "");
  await prisma.article.update({
    where: { id: article.id },
    data: { contentPath: relativePath(article.id) },
  });
  logMutation("article", "create", { id: article.id, title: article.title, spaceId: article.spaceId });
  return NextResponse.json({ article }, { status: 201 });
});
