import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { normalizeColor } from "@/lib/tasks/tag-colors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tags — 列出全部标签（含未废弃任务数）
export async function GET() {
  const tags = await prisma.tag.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { tasks: { where: { task: { trashed: false } } } } },
    },
  });
  return NextResponse.json({ tags });
}

const createSchema = z.object({
  name: z.string().trim().min(1, "标签名不能为空").max(50),
  color: z.string().optional(),
});

// POST /api/tags — 创建标签
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { name, color } = parsed.data;
    const tag = await prisma.tag.create({
      data: { name, color: normalizeColor(color ?? "#6b7280") },
    });
    return NextResponse.json({ tag }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "标签名已存在" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "创建标签失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
