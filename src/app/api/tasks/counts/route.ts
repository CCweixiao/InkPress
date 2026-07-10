import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tasks/counts — 侧边栏聚合计数
export async function GET() {
  // 主视图（未废弃）按 spaceId 聚合
  const active = await prisma.task.groupBy({
    by: ["spaceId"],
    where: { trashed: false },
    _count: true,
  });

  const bySpace: Record<string, number> = {};
  let total = 0;
  let inbox = 0;
  for (const row of active) {
    const count = row._count;
    total += count;
    if (row.spaceId === null) {
      inbox += count;
    } else {
      bySpace[row.spaceId] = count;
    }
  }

  // 垃圾箱：只计 trashed root
  const trashed = await prisma.task.count({
    where: {
      trashed: true,
      OR: [{ parentId: null }, { parent: { trashed: false } }],
    },
  });

  return NextResponse.json({ total, inbox, bySpace, trashed });
}
