import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { computeExpiresAt } from "@/lib/tasks/trash-lifecycle";

const patchSchema = z.object({ name: z.string().min(1).max(80).optional(), color: z.string().optional(), sortOrder: z.number().int().optional() });
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (id === "unsectioned") {
    const listId = req.nextUrl.searchParams.get("listId");
    if (!listId || !parsed.data.name) return NextResponse.json({ error: "缺少清单或分组名称" }, { status: 400 });
    const list = await prisma.taskList.update({ where: { id: listId }, data: { ungroupedName: parsed.data.name, ungroupedVisible: true } });
    return NextResponse.json({ section: { id, name: list.ungroupedName } });
  }
  const section = await prisma.taskSection.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ section });
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const listId = req.nextUrl.searchParams.get("listId");
  const targetSectionId = req.nextUrl.searchParams.get("targetSectionId");
  if (id === "unsectioned") {
    if (!listId) return NextResponse.json({ error: "缺少清单" }, { status: 400 });
    if (req.nextUrl.searchParams.get("mode") === "move") {
      if (!targetSectionId) return NextResponse.json({ error: "请选择目标分组" }, { status: 400 });
      await prisma.task.updateMany({ where: { listId, sectionId: null, trashed: false }, data: { sectionId: targetSectionId } });
    } else {
      const now = new Date();
      const expiresAt = computeExpiresAt(now);
      await prisma.task.updateMany({ where: { listId, sectionId: null, trashed: false }, data: { trashed: true, trashedAt: now, expiresAt } });
    }
    await prisma.taskList.update({ where: { id: listId }, data: { ungroupedVisible: false } });
    return NextResponse.json({ success: true });
  }
  if (req.nextUrl.searchParams.get("mode") === "tasks") {
    const now = new Date();
    const expiresAt = computeExpiresAt(now);
    const roots = await prisma.task.findMany({ where: { sectionId: id }, select: { id: true } });
    const trashTree = async (taskId: string): Promise<void> => {
      await prisma.task.update({ where: { id: taskId }, data: { trashed: true, trashedAt: now, expiresAt } });
      const children = await prisma.task.findMany({ where: { parentId: taskId }, select: { id: true } });
      for (const child of children) await trashTree(child.id);
    };
    for (const root of roots) await trashTree(root.id);
  }
  if (req.nextUrl.searchParams.get("mode") === "move") {
    const section = await prisma.taskSection.findUnique({ where: { id }, select: { listId: true } });
    if (section) await prisma.taskList.update({ where: { id: section.listId }, data: { ungroupedVisible: true } });
  }
  await prisma.taskSection.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
