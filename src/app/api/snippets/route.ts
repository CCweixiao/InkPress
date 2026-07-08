import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 素材块列表（支持 kind / tag / q / cursor 分页） */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind") || undefined;
  const tag = sp.get("tag") || undefined;
  const q = sp.get("q") || undefined;
  const cursor = sp.get("cursor") || undefined;
  const limit = Math.min(Number(sp.get("limit") || 20), 100);
  const trashed = sp.get("trashed") === "1";

  const where: Record<string, unknown> = { trashed };
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
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = snippets.length > limit;
  if (hasMore) snippets.pop();
  const nextCursor = hasMore ? snippets[snippets.length - 1]?.id : null;

  return NextResponse.json({ snippets, nextCursor });
}

const createSchema = z.object({
  title: z.string().optional().default(""),
  content: z.string().min(1),
  kind: z.enum(["text", "image", "quote", "link"]).optional().default("text"),
  imageUrl: z.string().nullable().optional(),
  imageAssetId: z.string().nullable().optional(),
  imagesJson: z.string().optional(),
  quoteSource: z.string().nullable().optional(),
  linkUrl: z.string().nullable().optional(),
  linkTitle: z.string().nullable().optional(),
  linkDescription: z.string().nullable().optional(),
  linkImage: z.string().nullable().optional(),
  tags: z.array(z.string()).optional().default([]),
  color: z.string().nullable().optional(),
  sourceArticleId: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
});

/** 创建素材块 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { tags, ...data } = parsed.data;
  // 自动从 content 首行提取 title（trim 避免空白标题）
  const title =
    data.title.trim() ||
    data.content.trim().split("\n")[0].slice(0, 50) ||
    "无标题";

  const snippet = await prisma.snippet.create({
    data: {
      ...data,
      title,
      tagsJson: JSON.stringify(tags),
    },
  });

  return NextResponse.json({ snippet }, { status: 201 });
}
