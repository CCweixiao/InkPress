import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** @面板专用：轻量快速检索（返回精简字段） */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") || "";
  const kind = sp.get("kind") || undefined;
  const tag = sp.get("tag") || undefined;
  const limit = Math.min(Number(sp.get("limit") || 8), 20);

  const where: Record<string, unknown> = { trashed: false };
  if (kind) where.kind = kind;
  if (tag) where.tagsJson = { contains: `"${tag}"` };
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { content: { contains: q } },
      { tagsJson: { contains: q } },
    ];
  }

  const snippets = await prisma.snippet.findMany({
    where,
    orderBy: [{ usageCount: "desc" }, { updatedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      title: true,
      aiSummary: true,
      content: true,
      kind: true,
      tagsJson: true,
      imageUrl: true,
      color: true,
      updatedAt: true,
    },
  });

  const items = snippets.map((s) => ({
    id: s.id,
    title: s.title,
    summary: s.aiSummary || s.content.slice(0, 80),
    kind: s.kind,
    tags: JSON.parse(s.tagsJson) as string[],
    imageUrl: s.imageUrl,
    color: s.color,
    updatedAt: s.updatedAt,
  }));

  return NextResponse.json({ items });
}
