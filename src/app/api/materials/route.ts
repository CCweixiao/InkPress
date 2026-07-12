import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hasOssConfig } from "@/lib/oss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 素材列表（默认排除回收站，支持 ?kind / ?spaceId / ?articleId 过滤）
 * spaceId=none 表示筛选无空间归属的素材 */
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") || undefined;
  const spaceIdRaw = req.nextUrl.searchParams.get("spaceId");
  const articleId = req.nextUrl.searchParams.get("articleId") || undefined;
  const wechatAccountId = req.nextUrl.searchParams.get("wechatAccountId") || undefined;
  const includeTrashed =
    req.nextUrl.searchParams.get("trashed") === "1" ? undefined : false;

  const spaceIdFilter =
    spaceIdRaw === "none"
      ? null
      : spaceIdRaw
        ? spaceIdRaw
        : undefined;

  const assets = await prisma.asset.findMany({
    where: {
      trashed: includeTrashed,
      ...(kind ? { kind } : {}),
      ...(articleId ? { articleId } : {}),
      ...(spaceIdFilter !== undefined ? { spaceId: spaceIdFilter } : {}),
      ...(wechatAccountId ? { OR: [{ wechatBindings: { none: {} } }, { wechatBindings: { some: { accountId: wechatAccountId } } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ assets, ossConfigured: await hasOssConfig() });
}

const deleteSchema = z.object({ id: z.string().min(1) });

/** 删除素材（软删除到回收站，30 天后过期） */
export async function DELETE(req: NextRequest) {
  const parsed = deleteSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "缺少素材 id。" }, { status: 400 });
  }
  const asset = await prisma.asset.findUnique({
    where: { id: parsed.data.id },
  });
  if (!asset) {
    return NextResponse.json({ error: "素材不存在。" }, { status: 404 });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await prisma.asset.update({
    where: { id: asset.id },
    data: { trashed: true, trashedAt: now, expiresAt },
  });
  return NextResponse.json({ ok: true });
}
