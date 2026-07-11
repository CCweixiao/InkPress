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

  const trashed = await prisma.task.count({
    where: {
      trashed: true,
      OR: [{ parentId: null }, { parent: { trashed: false } }],
    },
  });

  return NextResponse.json({ total, byList, trashed });
}
