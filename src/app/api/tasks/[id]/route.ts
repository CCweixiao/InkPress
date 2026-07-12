import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { computeExpiresAt } from "@/lib/tasks/trash-lifecycle";

const updateSchema = z.object({
  title: z.string().min(1).max(50).optional(),
  content: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done", "archived"]).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  dueDate: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  listId: z.string().nullable().optional(),
  sectionId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  tagsJson: z.string().optional(),
  isCollapsed: z.boolean().optional(),
  tagIds: z.array(z.string()).max(5, "最多 5 个标签").optional(),
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
    const { title, content, status, priority, dueDate, parentId, listId, sectionId, sortOrder, tagsJson, isCollapsed, tagIds } =
      parsed.data;
    if (listId === null) return NextResponse.json({ error: "任务必须归属一个清单" }, { status: 400 });
    const destinationListId = listId ?? undefined;

    if (sectionId !== undefined) {
      const targetListId = destinationListId ?? (await prisma.task.findUnique({ where: { id }, select: { listId: true } }))?.listId;
      if (!targetListId) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
      if (sectionId === null) {
        const list = await prisma.taskList.findUnique({ where: { id: targetListId }, select: { ungroupedVisible: true, ungroupedName: true } });
        if (!list?.ungroupedVisible) {
          return NextResponse.json({ error: "该清单未启用默认分组，不能归入该分组" }, { status: 400 });
        }
      } else {
        const section = await prisma.taskSection.findFirst({ where: { id: sectionId, listId: targetListId }, select: { id: true } });
        if (!section) return NextResponse.json({ error: "分组不属于目标清单" }, { status: 400 });
      }
    }

    if (priority !== undefined || tagIds !== undefined || tagsJson !== undefined || listId !== undefined || sectionId !== undefined) {
      const targetTask = await prisma.task.findUnique({ where: { id }, select: { parentId: true } });
      if (targetTask?.parentId) {
        return NextResponse.json({ error: "子任务继承最父级任务的优先级、标签和归属，不能单独修改" }, { status: 400 });
      }
    }

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
    if (listId !== undefined) data.listId = listId;
    if (sectionId !== undefined) data.sectionId = sectionId;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (tagsJson !== undefined) data.tagsJson = tagsJson;
    if (isCollapsed !== undefined) data.isCollapsed = isCollapsed;

    if (parentId) {
      const depthError = await validateParentDepth(parentId, id);
      if (depthError) return NextResponse.json({ error: depthError }, { status: 400 });
    }

    const task = await prisma.$transaction(async (tx) => {
      if (tagIds !== undefined) {
        await tx.taskTag.deleteMany({ where: { taskId: id } });
        if (tagIds.length > 0) {
          await tx.taskTag.createMany({
            data: tagIds.map((tagId) => ({ taskId: id, tagId })),
          });
        }
      }
      // 顶级任务的优先级和标签是整棵任务树的统一元数据，改动后同步到后两级子任务。
      if (priority !== undefined || tagIds !== undefined) {
        const children = await tx.task.findMany({ where: { parentId: id }, select: { id: true } });
        const childIds = children.map((child) => child.id);
        const grandchildren = childIds.length
          ? await tx.task.findMany({ where: { parentId: { in: childIds } }, select: { id: true } })
          : [];
        const descendantIds = [...childIds, ...grandchildren.map((child) => child.id)];

        if (descendantIds.length > 0 && priority !== undefined) {
          await tx.task.updateMany({ where: { id: { in: descendantIds } }, data: { priority } });
        }
        if (descendantIds.length > 0 && tagIds !== undefined) {
          await tx.taskTag.deleteMany({ where: { taskId: { in: descendantIds } } });
          if (tagIds.length > 0) {
            await tx.taskTag.createMany({
              data: descendantIds.flatMap((taskId) => tagIds.map((tagId) => ({ taskId, tagId }))),
            });
          }
        }
      }
      // 顶级任务调整清单或自定义分组时，后代同步迁移，保持整棵任务树归属一致。
      if (destinationListId !== undefined || sectionId !== undefined) {
        const children = await tx.task.findMany({ where: { parentId: id }, select: { id: true } });
        const childIds = children.map((child) => child.id);
        const grandchildren = childIds.length
          ? await tx.task.findMany({ where: { parentId: { in: childIds } }, select: { id: true } })
          : [];
        const descendantIds = [...childIds, ...grandchildren.map((child) => child.id)];
        if (descendantIds.length > 0) {
          await tx.task.updateMany({
            where: { id: { in: descendantIds } },
            data: {
              ...(destinationListId !== undefined ? { listId: destinationListId } : {}),
              ...(sectionId !== undefined ? { sectionId } : {}),
            },
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

/** 防止移动任务形成环，并将整个任务树限制在三层以内。 */
async function validateParentDepth(parentId: string, movingTaskId: string): Promise<string | null> {
  let currentId: string | null = parentId;
  let depth = 0;
  const visited = new Set<string>();
  while (currentId) {
    if (visited.has(currentId) || currentId === movingTaskId) return "不能将任务移动到其自身或后代任务下";
    visited.add(currentId);
    const current: { parentId: string | null } | null = await prisma.task.findUnique({ where: { id: currentId }, select: { parentId: true } });
    if (!current) return "父任务不存在";
    depth += 1;
    if (depth >= 3) return "子任务最多支持 3 级";
    currentId = current.parentId;
  }
  return null;
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
