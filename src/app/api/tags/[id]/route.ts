import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { updateTag, deleteTag } from "@/lib/tasks/tag-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(10).optional(),
  color: z.string().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/tags/[id]
export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    await updateTag(id, parsed.data);
    const tag = await prisma.tag.findUnique({ where: { id } });
    return NextResponse.json({ tag });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "标签名已存在" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "更新标签失败";
    const status =
      message.includes("父标签") ||
      message.includes("三级") ||
      message.includes("自己") ||
      message.includes("环")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE /api/tags/[id] — 子标签提升为一级，再删该 tag（TaskTag 级联清）
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await deleteTag(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除标签失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
