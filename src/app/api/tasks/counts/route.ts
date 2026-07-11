import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const active = await prisma.task.groupBy({
    by: ["listId"],
    where: { trashed: false },
    _count: true,
  });

  const byList: Record<string, number> = {};
  let total = 0;
  for (const row of active) {
    const count = row._count;
    total += count;
    if (row.listId !== null) {
      byList[row.listId] = count;
    }
  }

  // legacy bySpace + inbox（桥接期保留，Task 9 移除）
  const bySpaceActive = await prisma.task.groupBy({
    by: ["spaceId"],
    where: { trashed: false },
    _count: true,
  });
  const bySpace: Record<string, number> = {};
  let inbox = 0;
  for (const row of bySpaceActive) {
    const count = row._count;
    if (row.spaceId === null) inbox += count;
    else bySpace[row.spaceId] = count;
  }

  const trashed = await prisma.task.count({
    where: {
      trashed: true,
      OR: [{ parentId: null }, { parent: { trashed: false } }],
    },
  });

  return NextResponse.json({ total, inbox, bySpace, byList, trashed });
}
