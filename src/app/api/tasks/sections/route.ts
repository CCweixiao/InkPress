import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  listId: z.string().min(1),
  color: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const max = await prisma.taskSection.aggregate({ where: { listId: parsed.data.listId }, _max: { sortOrder: true } });
  const section = await prisma.taskSection.create({
    data: { ...parsed.data, color: parsed.data.color ?? "#64748b", sortOrder: (max._max.sortOrder ?? -1) + 1 },
  });
  return NextResponse.json({ section }, { status: 201 });
}
