import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 获取所有标签（去重 + 计数） */
export async function GET() {
  const snippets = await prisma.snippet.findMany({
    where: { trashed: false },
    select: { tagsJson: true },
  });

  const tagCounts = new Map<string, number>();
  for (const s of snippets) {
    try {
      const tags: string[] = JSON.parse(s.tagsJson);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    } catch {
      // skip invalid JSON
    }
  }

  const tags = Array.from(tagCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ tags });
}
