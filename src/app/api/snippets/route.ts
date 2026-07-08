import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateAndSaveAiSummary } from "@/lib/snippets/ai-summary";
import { generateAndSaveEmbedding } from "@/lib/snippets/embedding";
import { generateAndSaveOg } from "@/lib/snippets/link-og";
import { getEmbeddingConfig } from "@/lib/ai/embedding-config";
import {
  findSemanticSnippets,
  mergeKeywordAndSemantic,
} from "@/lib/snippets/semantic-search";
import {
  syncSnippetTags,
  serializeSnippet,
  withTagsInclude,
  tagWhere,
  tagSearchWhere,
} from "@/lib/snippets/tag-repo";

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
  if (tag) Object.assign(where, tagWhere(tag));
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { content: { contains: q } },
      tagSearchWhere(q),
    ];
  }

  const snippets = await prisma.snippet.findMany({
    where,
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: limit + 1,
    include: withTagsInclude,
    omit: { embedding: true, tagsJson: true }, // 不把 KB 级向量/废弃 tagsJson 灌给前端
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = snippets.length > limit;
  if (hasMore) snippets.pop();
  const nextCursor = hasMore ? snippets[snippets.length - 1]?.id : null;

  // 语义补充：q 非空 + 配了 embedding 时，用语义命中填补剩余 slot（keyword 优先）。
  let merged = snippets;
  if (q) {
    const cfg = await getEmbeddingConfig();
    if (cfg) {
      const hits = await findSemanticSnippets(q, { topK: limit, threshold: 0.3 });
      if (hits.length) {
        const semSnippets = await prisma.snippet.findMany({
          where: { id: { in: hits.map((h) => h.id) }, trashed: false },
          include: withTagsInclude,
          omit: { embedding: true, tagsJson: true },
        });
        const scores: Record<string, number> = {};
        for (const h of hits) scores[h.id] = h.score;
        merged = mergeKeywordAndSemantic(snippets, semSnippets, scores, limit);
      }
    }
  }

  return NextResponse.json({ snippets: merged.map(serializeSnippet), nextCursor });
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

  const created = await prisma.snippet.create({
    data: { ...data, title },
  });
  await syncSnippetTags(created.id, tags);

  // 异步：link 先抓 OG（填 linkDescription）→ aiSummary（copy 策略可命中）→ embedding。
  after(async () => {
    await generateAndSaveOg(created.id, { force: true });
    void generateAndSaveAiSummary(created.id);
    void generateAndSaveEmbedding(created.id);
  });

  const snippet = serializeSnippet(
    await prisma.snippet.findUniqueOrThrow({
      where: { id: created.id },
      include: withTagsInclude,
      omit: { embedding: true, tagsJson: true },
    })
  );
  return NextResponse.json({ snippet }, { status: 201 });
}
