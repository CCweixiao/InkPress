import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateAndSaveAiSummary } from "@/lib/snippets/ai-summary";
import { generateAndSaveEmbedding } from "@/lib/snippets/embedding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  kind: z.enum(["text", "image", "quote", "link"]).optional(),
  imageUrl: z.string().nullable().optional(),
  imageAssetId: z.string().nullable().optional(),
  imagesJson: z.string().optional(),
  quoteSource: z.string().nullable().optional(),
  linkUrl: z.string().nullable().optional(),
  linkTitle: z.string().nullable().optional(),
  linkDescription: z.string().nullable().optional(),
  linkImage: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  color: z.string().nullable().optional(),
  sourceArticleId: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
});

/** 更新素材块 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.snippet.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "素材块不存在" }, { status: 404 });
  }

  const { tags, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (tags !== undefined) {
    data.tagsJson = JSON.stringify(tags);
  }

  const snippet = await prisma.snippet.update({ where: { id }, data });

  // 输入字段变化时异步重生成 aiSummary；只改 tag/color/pinned 等不触发。
  const inputChanged =
    (rest.content !== undefined && rest.content !== existing.content) ||
    (rest.kind !== undefined && rest.kind !== existing.kind) ||
    (rest.quoteSource !== undefined &&
      (rest.quoteSource ?? null) !== existing.quoteSource) ||
    (rest.linkTitle !== undefined &&
      (rest.linkTitle ?? null) !== existing.linkTitle) ||
    (rest.linkDescription !== undefined &&
      (rest.linkDescription ?? null) !== existing.linkDescription);
  if (inputChanged) {
    after(() => {
      void generateAndSaveAiSummary(id);
      void generateAndSaveEmbedding(id);
    });
  }

  return NextResponse.json({ snippet });
}

/** 软删除素材块（移入回收站） */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.snippet.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "素材块不存在" }, { status: 404 });
  }

  await prisma.snippet.update({
    where: { id },
    data: { trashed: true, trashedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
