import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 列出全部空间（排除回收站）。排序：默认空间 > 置顶 > createdAt 倒序（boolean orderBy 在 SQLite 不可靠，应用层排序）
export async function GET() {
  const spaces = await prisma.space.findMany({
    where: { trashed: false },
    include: {
      _count: { select: { articles: { where: { trashed: false } } } },
    },
  });
  spaces.sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      Number(b.pinned) - Number(a.pinned) ||
      b.createdAt.getTime() - a.createdAt.getTime()
  );
  return NextResponse.json({ spaces });
}

const createSchema = z.object({
  name: z.string().trim().min(1, "请输入空间名称").max(60),
  description: z.string().max(300).optional(),
  tags: z.array(z.string()).max(10).optional(),
  pinned: z.boolean().optional(),
});

// 新建空间
export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, description, tags, pinned } = parsed.data;
  const maxOrder = await prisma.space.aggregate({ _max: { sortOrder: true } });
  const space = await prisma.space.create({
    data: {
      name,
      description: description ?? "",
      tagsJson: JSON.stringify(tags ?? []),
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      pinned: pinned ?? false,
    },
  });
  return NextResponse.json({ space }, { status: 201 });
}
