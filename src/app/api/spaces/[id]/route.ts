import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().max(300).optional(),
  tags: z.array(z.string()).max(10).optional(),
  sortOrder: z.number().int().optional(),
  pinned: z.boolean().optional(),
});

// 获取单个空间
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const space = await prisma.space.findUnique({ where: { id } });
  if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ space });
}

// 更新空间（默认空间不可编辑）
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const existing = await prisma.space.findUnique({ where: { id } });
  if (existing?.isDefault) {
    return NextResponse.json(
      { error: "默认空间不可编辑" },
      { status: 400 }
    );
  }
  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tags, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (tags) data.tagsJson = JSON.stringify(tags);
  const space = await prisma.space.update({ where: { id }, data });
  return NextResponse.json({ space });
}

// 删除空间（默认空间不可删；软删除到回收站；前置校验：其下非回收文章数须为 0）
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const existing = await prisma.space.findUnique({ where: { id } });
  if (existing?.isDefault) {
    return NextResponse.json(
      { error: "默认空间不可删除" },
      { status: 400 }
    );
  }
  const activeCount = await prisma.article.count({
    where: { spaceId: id, trashed: false },
  });
  if (activeCount > 0) {
    return NextResponse.json(
      {
        error: `该空间下还有 ${activeCount} 篇文章，请先删除或移出这些文章后再删除空间。`,
      },
      { status: 400 }
    );
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await prisma.space.update({
    where: { id },
    data: { trashed: true, trashedAt: now, expiresAt },
  });
  // 空间级素材一并软删
  await prisma.asset.updateMany({
    where: { spaceId: id, trashed: false },
    data: { trashed: true, trashedAt: now, expiresAt },
  });
  return NextResponse.json({ ok: true });
}
