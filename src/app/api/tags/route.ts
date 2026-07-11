import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { createTag } from "@/lib/tasks/tag-repo";

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
  parentId: z.string().nullable().optional(),
});

// POST /api/tags — 创建标签
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { name, color, parentId } = parsed.data;
    const tag = await createTag({ name, color, parentId: parentId ?? null });
    return NextResponse.json({ tag }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "标签名已存在" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "创建标签失败";
    // 层级校验错误统一 400
    const status =
      message.includes("父标签") || message.includes("三级") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
