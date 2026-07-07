import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApiLog, logMutation } from "@/lib/api-log";
import { NAME_REGEX } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请输入空间名称")
    .max(20, "空间名称不能超过 20 字")
    .regex(NAME_REGEX, "空间名称包含不支持的字符")
    .optional(),
  description: z.string().max(100, "空间描述不能超过 100 字").optional(),
  tags: z
    .array(z.string().trim().max(10, "单个标签不能超过 10 字"))
    .max(5, "最多 5 个标签")
    .optional(),
  sortOrder: z.number().int().optional(),
  pinned: z.boolean().optional(),
});

// 获取单个空间
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const space = await prisma.space.findUnique({ where: { id } });
  if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ space });
}

// 更新空间（默认空间不可编辑）
export const PUT = withApiLog("PUT /api/spaces/[id]", async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const existing = await prisma.space.findUnique({ where: { id } });
  if (existing?.isDefault) {
    return NextResponse.json(
      { error: "默认空间不可编辑" },
      { status: 400 }
    );
  }
  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // 重名校验：仅当本次提交了 name 时检查，排除自身，仅对未软删空间判重
  if (parsed.data.name) {
    const duplicated = await prisma.space.findFirst({
      where: { name: parsed.data.name, trashed: false, id: { not: id } },
    });
    if (duplicated) {
      return NextResponse.json({ error: "空间名称已存在" }, { status: 400 });
    }
  }
  const { tags, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (tags) data.tagsJson = JSON.stringify(tags);
  const space = await prisma.space.update({ where: { id }, data });
  logMutation("space", "update", { id, name: space.name });
  return NextResponse.json({ space });
});

// 删除空间（默认空间不可删；软删除到回收站；前置校验：其下非回收文章数须为 0）
export const DELETE = withApiLog("DELETE /api/spaces/[id]", async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const existing = await prisma.space.findUnique({ where: { id } });
  if (existing?.isDefault) {
    return NextResponse.json(
      { error: "默认空间不可删除" },
      { status: 400 }
    );
  }
  const activeCount = await prisma.article.count({
    where: { spaceId: id, trashed: false },
  });
  if (activeCount > 0) {
    return NextResponse.json(
      {
        error: `该空间下还有 ${activeCount} 篇文章，请先删除或移出这些文章后再删除空间。`,
      },
      { status: 400 }
    );
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await prisma.space.update({
    where: { id },
    data: { trashed: true, trashedAt: now, expiresAt },
  });
  // 空间级素材一并软删
  await prisma.asset.updateMany({
    where: { spaceId: id, trashed: false },
    data: { trashed: true, trashedAt: now, expiresAt },
  });
  logMutation("space", "trash", { id });
  return NextResponse.json({ ok: true });
});
