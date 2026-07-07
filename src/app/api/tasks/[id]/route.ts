import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done", "archived"]).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  dueDate: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  spaceId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  tagsJson: z.string().optional(),
  isCollapsed: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/tasks/[id]
export async function GET(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      children: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        include: { children: true },
      },
    },
  });
  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ task });
}

// PATCH /api/tasks/[id]
export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    const { title, content, status, priority, dueDate, parentId, spaceId, sortOrder, tagsJson, isCollapsed } =
      parsed.data;

    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (status !== undefined) {
      data.status = status;
      // 自动设置完成时间
      if (status === "done") {
        data.completedAt = new Date();
      } else {
        data.completedAt = null;
      }
    }
    if (priority !== undefined) data.priority = priority;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (parentId !== undefined) data.parentId = parentId;
    if (spaceId !== undefined) data.spaceId = spaceId;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (tagsJson !== undefined) data.tagsJson = tagsJson;
    if (isCollapsed !== undefined) data.isCollapsed = isCollapsed;

    const task = await prisma.task.update({
      where: { id },
      data,
      include: { children: true },
    });

    return NextResponse.json({ task });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新任务失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/tasks/[id]
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await prisma.task.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "删除任务失败" }, { status: 500 });
  }
}
