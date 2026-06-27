import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { storageDir } from "@/lib/paths";
import { spacePrefix } from "@/lib/storage/layout";
import { withApiLog, logMutation } from "@/lib/api-log";
import { NAME_REGEX } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 列出全部空间（排除回收站）。排序：默认空间 > 置顶 > createdAt 倒序（boolean orderBy 在 SQLite 不可靠，应用层排序）
export async function GET() {
  const spaces = await prisma.space.findMany({
    where: { trashed: false },
    include: {
      _count: { select: { articles: { where: { trashed: false } } } },
    },
  });
  spaces.sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      Number(b.pinned) - Number(a.pinned) ||
      b.createdAt.getTime() - a.createdAt.getTime()
  );
  return NextResponse.json({ spaces });
}

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请输入空间名称")
    .max(20, "空间名称不能超过 20 字")
    .regex(NAME_REGEX, "空间名称包含不支持的字符"),
  description: z.string().max(100, "空间描述不能超过 100 字").optional(),
  tags: z
    .array(z.string().trim().max(10, "单个标签不能超过 10 字"))
    .max(5, "最多 5 个标签")
    .optional(),
  pinned: z.boolean().optional(),
});

// 新建空间
export const POST = withApiLog("POST /api/spaces", async (req: NextRequest) => {
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, description, tags, pinned } = parsed.data;
  // 重名校验：精确匹配，仅对未软删空间判重
  const duplicated = await prisma.space.findFirst({
    where: { name, trashed: false },
  });
  if (duplicated) {
    return NextResponse.json({ error: "空间名称已存在" }, { status: 400 });
  }
  const maxOrder = await prisma.space.aggregate({ _max: { sortOrder: true } });
  const space = await prisma.space.create({
    data: {
      name,
      description: description ?? "",
      tagsJson: JSON.stringify(tags ?? []),
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      pinned: pinned ?? false,
    },
  });
  // 创建后在 storage 下建空间目录（spaces/<safeSegment(id)>）
  await fs.mkdir(path.join(storageDir(), spacePrefix(space.id)), {
    recursive: true,
  });
  logMutation("space", "create", { id: space.id, name: space.name });
  return NextResponse.json({ space }, { status: 201 });
});
