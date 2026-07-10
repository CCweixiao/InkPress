import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// DELETE /api/tasks/[id]/purge — 彻底删除（cascade children）
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await prisma.task.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "彻底删除失败" }, { status: 500 });
  }
}
