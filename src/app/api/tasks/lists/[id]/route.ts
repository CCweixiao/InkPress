import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateList, deleteList } from "@/lib/tasks/list-repo";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().optional(),
  folderId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  viewMode: z.enum(["list", "kanban", "calendar"]).optional(),
  groupMode: z.enum(["status", "week", "custom"]).optional(),
  ungroupedName: z.string().min(1).max(80).optional(),
  ungroupedVisible: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const list = await prisma.taskList.findUnique({
    where: { id },
    include: { sections: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  if (!list) return NextResponse.json({ error: "清单不存在" }, { status: 404 });
  return NextResponse.json({ list });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const list = await updateList(id, parsed.data);
  return NextResponse.json({ list });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await deleteList(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "删除清单失败" }, { status: 500 });
  }
}
