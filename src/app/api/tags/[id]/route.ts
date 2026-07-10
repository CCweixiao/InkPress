import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { normalizeColor } from "@/lib/tasks/tag-colors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: z.string().optional(),
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
    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.color !== undefined) data.color = normalizeColor(parsed.data.color);
    if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;

    const tag = await prisma.tag.update({ where: { id }, data });
    return NextResponse.json({ tag });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "标签名已存在" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "更新标签失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/tags/[id] — cascade 清 TaskTag，任务保留
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await prisma.tag.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "删除标签失败" }, { status: 500 });
  }
}
