import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { storageDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const graph = await prisma.codeGraphCache.findUnique({
    where: { id },
    select: { graphPath: true },
  });
  if (!graph?.graphPath) {
    return NextResponse.json({ error: "图谱文件不存在。" }, { status: 404 });
  }
  const storageRoot = path.resolve(storageDir());
  const abs = path.resolve(storageRoot, graph.graphPath);
  if (abs !== storageRoot && !abs.startsWith(`${storageRoot}${path.sep}`)) {
    return NextResponse.json({ error: "图谱文件不存在。" }, { status: 404 });
  }
  const body = await fs.readFile(abs).catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "图谱文件不存在。" }, { status: 404 });
  }
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=60",
    },
  });
}
