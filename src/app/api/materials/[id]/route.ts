import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { tagsToJson } from "@/lib/asset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  description: z.string().max(500).optional(),
  /** 标签数组（由前端拆分好传入），空数组表示清空 */
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
});

/** 编辑素材元数据（描述 / 标签） */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { description, tags } = parsed.data;
  const data: Record<string, unknown> = {};
  if (description !== undefined) data.description = description;
  if (tags !== undefined) data.tagsJson = tagsToJson(tags);

  const asset = await prisma.asset
    .update({ where: { id }, data })
    .catch(() => null);
  if (!asset) {
    return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  }
  return NextResponse.json({ asset });
}
