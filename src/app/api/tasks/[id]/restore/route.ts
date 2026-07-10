import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/tasks/[id]/restore — 恢复任务及其被废弃的后代
export async function POST(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await restoreSubtree(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "恢复任务失败" }, { status: 500 });
  }
}

/** 递归清除任务及其被废弃后代的 trashed 标记。 */
async function restoreSubtree(rootId: string): Promise<void> {
  await prisma.task.updateMany({
    where: { id: rootId, trashed: true },
    data: { trashed: false, trashedAt: null, expiresAt: null },
  });
  const children = await prisma.task.findMany({
    where: { parentId: rootId, trashed: true },
    select: { id: true },
  });
  for (const child of children) {
    await restoreSubtree(child.id);
  }
}
