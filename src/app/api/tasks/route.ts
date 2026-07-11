import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { filterBySmartView, type SmartView } from "@/lib/tasks/smart-views";
import type { Task } from "@/components/tasks/types";

const createSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done", "archived"]).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  dueDate: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  spaceId: z.string().nullable().optional(),
  listId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  tagsJson: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
});

// GET /api/tasks - 列出任务（支持筛选）
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");
  const spaceId = searchParams.get("spaceId");
  const listId = searchParams.get("listId");
  const folderId = searchParams.get("folderId");
  const parentId = searchParams.get("parentId");
  const priority = searchParams.get("priority");
  const smartViewRaw = searchParams.get("smartView");
  const smartView: SmartView | null =
    smartViewRaw === "today" || smartViewRaw === "next7days" || smartViewRaw === "inbox"
      ? smartViewRaw
      : null;
  const trashedFlag = searchParams.get("trashed") === "true";

  // 懒清理：删除已过期的废弃任务
  await prisma.task.deleteMany({
    where: { trashed: true, expiresAt: { lt: new Date() } },
  });

  const where: Record<string, unknown> = {};
  if (trashedFlag) {
    // 垃圾箱视图：只返回 trashed root
    where.trashed = true;
    where.OR = [{ parentId: null }, { parent: { trashed: false } }];
  } else {
    where.trashed = false;
    if (status) where.status = status;
    if (spaceId) where.spaceId = spaceId;
    if (listId) where.listId = listId;
    if (folderId) where.list = { folderId };
    if (parentId !== null && parentId !== undefined) {
      where.parentId = parentId === "null" ? null : parentId;
    } else {
      where.parentId = null;
    }
    if (priority) where.priority = parseInt(priority, 10);
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
          },
        },
      },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      space: { select: { id: true, name: true } },
      list: { select: { id: true, name: true, color: true, folderId: true, folder: { select: { id: true, name: true } } } },
    },
  });

  // 扁平化 tags: [{ tag: {...} }] → [{ ...tagInfo }]
  const flat = tasks.map((t) => ({
    ...t,
    tags: t.tags.map((tt) => tt.tag),
    children: t.children?.map((c) => ({ ...c, tags: c.tags?.map((tt) => tt.tag) ?? [] })),
  }));

  const result = smartView
    ? (filterBySmartView(flat as unknown as Task[], smartView) as unknown as typeof flat)
    : flat;

  return NextResponse.json({ tasks: result });
}

// POST /api/tasks - 创建任务
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { title, content, status, priority, dueDate, parentId, spaceId, listId, sortOrder, tagsJson, tagIds } =
      parsed.data;

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
        priority: priority ?? 0,
        dueDate: dueDate ? new Date(dueDate) : null,
        parentId: parentId ?? null,
        spaceId: spaceId ?? null,
        listId: listId ?? null,
        sortOrder: sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
        tagsJson: tagsJson ?? "[]",
        tags: tagIds?.length
          ? { create: tagIds.map((tagId) => ({ tagId })) }
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
