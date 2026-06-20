import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  title: z.string().max(200).optional(),
  themeId: z.string().optional(),
});

// 列出全部文章（按更新时间倒序）
export async function GET() {
  const articles = await prisma.article.findMany({
    orderBy: { updatedAt: "desc" },
    include: { theme: { select: { name: true } } },
  });
  return NextResponse.json({ articles });
}

// 新建文章
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const article = await prisma.article.create({
    data: {
      title: parsed.data.title ?? "无标题文章",
      themeId: parsed.data.themeId ?? null,
    },
  });
  return NextResponse.json({ article }, { status: 201 });
}
