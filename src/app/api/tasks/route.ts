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
  sortOrder: z.number().int().optional(),
  tagsJson: z.string().optional(),
});

// GET /api/tasks - 列出任务（支持筛选）
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");
  const spaceId = searchParams.get("spaceId");
  const parentId = searchParams.get("parentId");
  const priority = searchParams.get("priority");
  const smartViewRaw = searchParams.get("smartView");
  const smartView: SmartView | null =
    smartViewRaw === "today" || smartViewRaw === "next7days" || smartViewRaw === "inbox"
      ? smartViewRaw
      : null;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (spaceId) where.spaceId = spaceId;
  else if (smartView === "inbox") where.spaceId = null;
  if (parentId !== null && parentId !== undefined) {
    where.parentId = parentId === "null" ? null : parentId;
  } else {
    // 默认只返回顶层任务
    where.parentId = null;
  }
  if (priority) where.priority = parseInt(priority, 10);

  let tasks = await prisma.task.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: {
      children: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        include: {
          children: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
          },
        },
      },
    },
  });

  if (smartView) {
    tasks = filterBySmartView(tasks as unknown as Task[], smartView) as unknown as typeof tasks;
  }

  return NextResponse.json({ tasks });
}

// POST /api/tasks - 创建任务
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { title, content, status, priority, dueDate, parentId, spaceId, sortOrder, tagsJson } =
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
        sortOrder: sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
        tagsJson: tagsJson ?? "[]",
      },
      include: { children: true },
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建任务失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
