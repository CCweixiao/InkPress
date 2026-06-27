import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const graph = await prisma.codeGraphCache.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      lastError: true,
      nodeCount: true,
      edgeCount: true,
      provider: true,
      updatedAt: true,
    },
  });
  if (!graph) {
    return NextResponse.json({ error: "代码图谱不存在。" }, { status: 404 });
  }
  return NextResponse.json({
    status: graph.status,
    lastError: graph.lastError,
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    provider: graph.provider,
    updatedAt: graph.updatedAt.toISOString(),
  });
}
