import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [active, byTagRows, trashed] = await Promise.all([
    prisma.task.groupBy({
      by: ["listId"],
      where: { trashed: false },
      _count: true,
    }),
    prisma.taskTag.groupBy({
      by: ["tagId"],
      where: { task: { trashed: false } },
      _count: true,
    }),
    prisma.task.count({
      where: {
        trashed: true,
        OR: [{ parentId: null }, { parent: { trashed: false } }],
      },
    }),
  ]);

  const byList: Record<string, number> = {};
  let total = 0;
  for (const row of active) {
    const count = row._count;
    total += count;
    if (row.listId !== null) {
      byList[row.listId] = count;
    }
  }

  const byTag: Record<string, number> = {};
  for (const row of byTagRows) {
    byTag[row.tagId] = row._count;
  }

  return NextResponse.json(
    { total, byList, byTag, trashed },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}
