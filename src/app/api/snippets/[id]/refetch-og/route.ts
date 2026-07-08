import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateAndSaveOg } from "@/lib/snippets/link-og";
import { serializeSnippet, withTagsInclude } from "@/lib/snippets/tag-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 手动重新抓取 OG：同步 await（手动动作要即时反馈），返回更新后的 snippet。 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.snippet.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "素材块不存在" }, { status: 404 });
  }
  try {
    await generateAndSaveOg(id, { force: true });
    const snippet = await prisma.snippet.findUnique({
      where: { id },
      include: withTagsInclude,
      omit: { embedding: true, tagsJson: true },
    });
    return NextResponse.json({ snippet: snippet ? serializeSnippet(snippet) : null });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "重新抓取失败" },
      { status: 500 }
    );
  }
}
