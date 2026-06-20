import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  title: z.string().max(200).optional(),
  contentMd: z.string().optional(),
  digest: z.string().max(200).optional(),
  coverMediaId: z.string().nullable().optional(),
  themeId: z.string().nullable().optional(),
  status: z.enum(["draft", "ready", "pushed"]).optional(),
  wxMediaId: z.string().nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

// 获取单篇
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const article = await prisma.article.findUnique({
    where: { id },
    include: { theme: true },
  });
  if (!article) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ article });
}

// 更新（编辑器自动保存、发布等共用）
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const article = await prisma.article.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json({ article });
}

// 删除
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.article.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
