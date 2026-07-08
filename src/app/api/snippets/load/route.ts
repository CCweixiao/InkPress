import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(20),
});

/** AI 工具专用：批量加载素材完整内容 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = loadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const snippets = await prisma.snippet.findMany({
    where: { id: { in: parsed.data.ids }, trashed: false },
    select: {
      id: true,
      title: true,
      content: true,
      kind: true,
      imageUrl: true,
      quoteSource: true,
      linkUrl: true,
      linkTitle: true,
      tagAssignments: { include: { tag: { select: { name: true } } } },
    },
  });

  return NextResponse.json({
    snippets: snippets.map(({ tagAssignments, ...rest }) => ({
      ...rest,
      tags: tagAssignments.map((a) => a.tag.name),
    })),
  });
}
