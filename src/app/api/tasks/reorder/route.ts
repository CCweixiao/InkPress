import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const reorderSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      sortOrder: z.number().int(),
      parentId: z.string().nullable().optional(),
      sectionId: z.string().nullable().optional(),
      status: z.string().optional(),
    })
  ),
});

// POST /api/tasks/reorder - 批量更新排序（拖拽排序/看板切换）
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const updates = parsed.data.items.map((item) => {
      const data: Record<string, unknown> = { sortOrder: item.sortOrder };
      if (item.parentId !== undefined) data.parentId = item.parentId;
      if (item.sectionId !== undefined) data.sectionId = item.sectionId;
      if (item.status !== undefined) {
        data.status = item.status;
        if (item.status === "done") data.completedAt = new Date();
        else data.completedAt = null;
      }
      return prisma.task.update({ where: { id: item.id }, data });
    });

    await prisma.$transaction(updates);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "排序更新失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
