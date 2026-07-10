import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { computeExpiresAt } from "@/lib/tasks/trash-lifecycle";

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
  tagIds: z.array(z.string()).optional(),
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
    const { title, content, status, priority, dueDate, parentId, spaceId, sortOrder, tagsJson, isCollapsed, tagIds } =
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

    const task = await prisma.$transaction(async (tx) => {
      if (tagIds !== undefined) {
        await tx.taskTag.deleteMany({ where: { taskId: id } });
        if (tagIds.length > 0) {
          await tx.taskTag.createMany({
            data: tagIds.map((tagId) => ({ taskId: id, tagId })),
          });
        }
      }
      return tx.task.update({
        where: { id },
        data,
        include: {
          children: true,
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        },
      });
    });

    return NextResponse.json({ task });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新任务失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/tasks/[id] — 软删除（移入垃圾箱，级联后代，30 天后过期）
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const now = new Date();
    const expiresAt = computeExpiresAt(now);
    await trashSubtree(id, now, expiresAt);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "删除任务失败" }, { status: 500 });
  }
}

/** 递归标记任务及其所有后代为 trashed。 */
async function trashSubtree(rootId: string, now: Date, expiresAt: Date): Promise<void> {
  await prisma.task.update({
    where: { id: rootId },
    data: { trashed: true, trashedAt: now, expiresAt },
  });
  const children = await prisma.task.findMany({
    where: { parentId: rootId },
    select: { id: true },
  });
  for (const child of children) {
    await trashSubtree(child.id, now, expiresAt);
  }
}
