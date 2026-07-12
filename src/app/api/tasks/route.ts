import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { filterBySmartView, type SmartView } from "@/lib/tasks/smart-views";
import type { Task } from "@/components/tasks/types";

const createSchema = z.object({
  title: z.string().min(1).max(50),
  content: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done", "archived"]).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  dueDate: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  listId: z.string().nullable().optional(),
  sectionId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  tagsJson: z.string().optional(),
  tagIds: z.array(z.string()).max(5, "最多 5 个标签").optional(),
});

// GET /api/tasks - 列出任务（支持筛选）
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");
  const listId = searchParams.get("listId");
  const folderId = searchParams.get("folderId");
  const q = searchParams.get("q");
  const limitRaw = searchParams.get("limit");
  const tagId = searchParams.get("tagId");
  const parentId = searchParams.get("parentId");
  const priority = searchParams.get("priority");
  const smartViewRaw = searchParams.get("smartView");
  const smartView: SmartView | null =
    smartViewRaw === "today" || smartViewRaw === "next7days"
      ? smartViewRaw
      : null;
  const trashedFlag = searchParams.get("trashed") === "true";

  // 懒清理：删除已过期的废弃任务
  await prisma.task.deleteMany({
    where: { trashed: true, expiresAt: { lt: new Date() } },
  });

  // 全局搜索：q 存在时忽略其他 filter，只按 title contains + 非 trashed
  if (q) {
    const limit = Math.min(Math.max(parseInt(limitRaw ?? "10", 10) || 10, 1), 20);
    const searchTasks = await prisma.task.findMany({
      where: {
        title: { contains: q },
        trashed: false,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        list: {
          select: {
            id: true,
            name: true,
            color: true,
            folderId: true,
            folder: { select: { id: true, name: true } },
          },
        },
      },
    });
    const flat = searchTasks.map((t) => ({
      ...t,
      tags: t.tags.map((tt) => tt.tag),
    }));
    return NextResponse.json(
      { tasks: flat },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  const where: Record<string, unknown> = {};
  if (trashedFlag) {
    // 垃圾箱视图：只返回 trashed root
    where.trashed = true;
    where.OR = [{ parentId: null }, { parent: { trashed: false } }];
  } else {
    where.trashed = false;
    if (status) where.status = status;
    if (listId) where.listId = listId;
    if (folderId) where.list = { folderId };
    if (tagId) {
      // 查该 tag + 其所有二级子 tag 的 id（并集语义）
      const childTags = await prisma.tag.findMany({
        where: { parentId: tagId },
        select: { id: true },
      });
      const allTagIds = [tagId, ...childTags.map((t) => t.id)];
      const prevAnd = Array.isArray(where.AND) ? where.AND : [];
      where.AND = [...prevAnd, { tags: { some: { tagId: { in: allTagIds } } } }];
    }
    if (parentId !== null && parentId !== undefined) {
      where.parentId = parentId === "null" ? null : parentId;
    } else if (!tagId) {
      where.parentId = null;
    }
    if (priority) where.priority = parseInt(priority, 10);
  }

  // 标签视图使用扁平查询：不加载任务树，避免大量任务时产生重复数据和深层 include。
  if (tagId && !trashedFlag) {
    // 命中标签的可能是任意层级子任务。先回溯至根任务，再以根任务的清单/分组
    // 组织完整任务树，避免子任务缺少 sectionId 时显示为“未分组”。
    const tagMatches = await prisma.task.findMany({
      where,
      select: {
        id: true,
        parentId: true,
        parent: { select: { id: true, parentId: true, parent: { select: { id: true } } } },
      },
    });
    const rootIds = [...new Set(tagMatches.map((task) => task.parent?.parent?.id ?? task.parent?.id ?? task.id))];
    const taggedTasks = await prisma.task.findMany({
      where: { id: { in: rootIds }, trashed: false },
      orderBy: [{ updatedAt: "desc" }, { sortOrder: "asc" }],
      include: {
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        list: { select: { id: true, name: true, color: true, folderId: true, folder: { select: { id: true, name: true } } } },
        section: { select: { id: true, name: true, color: true } },
        children: {
          where: { trashed: false },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
          include: {
            tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
            children: {
              where: { trashed: false },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
              include: { tags: { include: { tag: { select: { id: true, name: true, color: true } } } } },
            },
          },
        },
      },
    });
    return NextResponse.json(
      { tasks: taggedTasks.map((task) => ({
        ...task,
        tags: task.tags.map((taskTag) => taskTag.tag),
        children: task.children.map((child) => ({
          ...child,
          tags: child.tags.map((taskTag) => taskTag.tag),
          children: child.children.map((grandchild) => ({ ...grandchild, tags: grandchild.tags.map((taskTag) => taskTag.tag) })),
        })),
      })) },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: trashedFlag
      ? [{ trashedAt: "desc" }]
      : [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: {
      children: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        where: { trashed: false },
        include: {
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
          children: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
            where: { trashed: false },
            include: {
              tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
            },
          },
        },
      },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      list: { select: { id: true, name: true, color: true, folderId: true, folder: { select: { id: true, name: true } } } },
    },
  });

  // 扁平化 tags: [{ tag: {...} }] → [{ ...tagInfo }]
  const flat = tasks.map((t) => ({
    ...t,
    tags: t.tags.map((tt) => tt.tag),
    children: t.children?.map((c) => ({
      ...c,
      tags: c.tags?.map((tt) => tt.tag) ?? [],
      children: c.children?.map((child) => ({ ...child, tags: child.tags?.map((tt) => tt.tag) ?? [] })),
    })),
  }));

  const result = smartView
    ? (filterBySmartView(flat as unknown as Task[], smartView) as unknown as typeof flat)
    : flat;

  return NextResponse.json(
    { tasks: result },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

// POST /api/tasks - 创建任务
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { title, content, status, priority, dueDate, parentId, listId, sectionId, sortOrder, tagsJson, tagIds } =
      parsed.data;

    // 未指定清单时，取第一个可用清单；无清单则报错
    let resolvedListId = listId;
    if (!resolvedListId) {
      const firstList = await prisma.taskList.findFirst({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        select: { id: true },
      });
      if (!firstList) {
        return NextResponse.json({ error: "请先创建一个清单" }, { status: 400 });
      }
      resolvedListId = firstList.id;
    }

    // 任务树统一限制为三级：根任务（第一级）→ 子任务 → 下级任务。
    // 这样看板和列表等不同入口不会创建无法完整展示的更深层级。
    let inheritedPriority: number | undefined;
    let inheritedTagIds: string[] | undefined;
    if (parentId) {
      const depthError = await validateParentDepth(parentId);
      if (depthError) return NextResponse.json({ error: depthError }, { status: 400 });
      const parent = await prisma.task.findUnique({ where: { id: parentId }, select: { listId: true, trashed: true } });
      if (!parent || parent.trashed) return NextResponse.json({ error: "父任务不存在" }, { status: 400 });
      if (parent.listId !== resolvedListId) return NextResponse.json({ error: "子任务必须属于与父任务相同的清单" }, { status: 400 });

      const rootTask = await findRootTask(parentId);
      inheritedPriority = rootTask.priority;
      inheritedTagIds = rootTask.tags.map((taskTag) => taskTag.tagId);
    }

    // 获取同级最大 sortOrder
    const maxSort = await prisma.task.aggregate({
      where: { parentId: parentId ?? null },
      _max: { sortOrder: true },
    });

    const task = await prisma.task.create({
      data: {
        title,
        content: content ?? "",
        status: status ?? "todo",
        priority: inheritedPriority ?? priority ?? 0,
        dueDate: dueDate ? new Date(dueDate) : null,
        parentId: parentId ?? null,
        listId: resolvedListId,
        sectionId: sectionId ?? null,
        sortOrder: sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
        tagsJson: tagsJson ?? "[]",
        tags: (inheritedTagIds ?? tagIds)?.length
          ? { create: (inheritedTagIds ?? tagIds ?? []).map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: { children: true, tags: { include: { tag: { select: { id: true, name: true, color: true } } } } },
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建任务失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** parent 的祖先数达到 3 时，再创建子项会成为第 4 级任务。 */
async function validateParentDepth(parentId: string, movingTaskId?: string): Promise<string | null> {
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

/** 返回任务树的最顶级任务，用于让子任务继承统一的优先级和标签。 */
async function findRootTask(taskId: string) {
  let currentId = taskId;
  while (true) {
    const task = await prisma.task.findUnique({
      where: { id: currentId },
      select: { id: true, parentId: true, priority: true, tags: { select: { tagId: true } } },
    });
    if (!task) throw new Error("父任务不存在");
    if (!task.parentId) return task;
    currentId = task.parentId;
  }
}
