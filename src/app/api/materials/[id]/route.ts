import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { tagsToJson } from "@/lib/asset";
import { withApiLog, logMutation } from "@/lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 获取单条素材（供上传后回显等场景使用） */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) {
    return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  }
  return NextResponse.json({ asset });
}

const patchSchema = z.object({
  description: z.string().max(500).optional(),
  /** 标签数组（由前端拆分好传入），空数组表示清空 */
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  /** 未传不变；[] 代表团队通用；有值代表仅允许指定公众号使用。 */
  wechatAccountIds: z.array(z.string().min(1)).max(50).optional(),
});

/** 编辑素材元数据（描述 / 标签） */
export const PATCH = withApiLog("PATCH /api/materials/[id]", async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { description, tags, wechatAccountIds } = parsed.data;
  const data: Record<string, unknown> = {};
  if (description !== undefined) data.description = description;
  if (tags !== undefined) data.tagsJson = tagsToJson(tags);

  const asset = await prisma.asset
    .update({ where: { id }, data })
    .catch(() => null);
  if (!asset) {
    return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  }
  if (wechatAccountIds !== undefined) {
    const accounts = await prisma.wechatAccount.count({ where: { id: { in: wechatAccountIds } } });
    if (accounts !== new Set(wechatAccountIds).size) return NextResponse.json({ error: "包含不存在的公众号。" }, { status: 400 });
    await prisma.assetWechatBinding.deleteMany({ where: { assetId: id } });
    if (wechatAccountIds.length) await prisma.assetWechatBinding.createMany({ data: [...new Set(wechatAccountIds)].map((accountId) => ({ assetId: id, accountId })) });
  }
  logMutation("asset", "update", { id });
  return NextResponse.json({ asset });
});
