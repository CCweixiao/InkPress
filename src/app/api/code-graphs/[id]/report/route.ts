import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { storageDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function readGraphFile(id: string, field: "reportPath" | "htmlPath" | "graphPath") {
  const graph = await prisma.codeGraphCache.findUnique({
    where: { id },
    select: { [field]: true },
  });
  if (!graph) return { status: 404 as const };
  const rel = graph[field];
  if (!rel) return { status: 404 as const };
  const storageRoot = path.resolve(storageDir());
  const abs = path.resolve(storageRoot, rel);
  if (abs !== storageRoot && !abs.startsWith(`${storageRoot}${path.sep}`)) {
    return { status: 404 as const };
  }
  const body = await fs.readFile(abs).catch(() => null);
  if (!body) return { status: 404 as const };
  return { status: 200 as const, body };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const result = await readGraphFile(id, "reportPath");
  if (result.status === 404) {
    return NextResponse.json({ error: "报告文件不存在。" }, { status: 404 });
  }
  return new NextResponse(result.body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "private, max-age=60",
    },
  });
}
