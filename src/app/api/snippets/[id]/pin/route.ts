import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 置顶/取消置顶素材块 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.snippet.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "素材块不存在" }, { status: 404 });
  }

  const snippet = await prisma.snippet.update({
    where: { id },
    data: { pinned: !existing.pinned },
  });
  return NextResponse.json({ snippet });
}
