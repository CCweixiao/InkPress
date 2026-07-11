import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getOrCreateAgentSession, findAgentSession } from "@/lib/ai/chat-persistence";
import { requireLicenseForApi } from "@/lib/license/guard";
import {
  composerDocumentToRuntimeText,
  buildSnippetReviewProgress,
  dedupeActiveSnippetReviews,
  fingerprintSnippet,
  findRedundantSnippetIds,
  isSameActiveSnippetReview,
  normalizeComposerDocument,
  type AppliedSnippetFingerprint,
  type ComposerDocument,
} from "@/lib/snippets/injection-review";
import { reviewSnippetInjectionWithAi } from "@/lib/snippets/injection-review-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const targetSchema = z.object({
  kind: z.enum(["article"]),
  id: z.string().min(1),
});

const composerSegmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("snippet"),
    id: z.string().min(1),
    title: z.string().min(1),
  }),
]);

const createSchema = z.object({
  target: targetSchema,
  composer: z.array(composerSegmentSchema).min(1),
  currentMarkdown: z.string().optional().default(""),
  providerId: z.string().nullable().optional(),
  modelId: z.string().nullable().optional(),
});

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeReview(review: {
  id: string;
  status: string;
  composerJson: string;
  snippetsJson: string;
  analysisJson: string;
  visibleText: string;
  runtimeText: string;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const error =
    review.error &&
    /(Expected ['\",}]|JSON|Unexpected end|property value|position \d+)/i.test(
      review.error
    )
      ? "灵感审核结果格式异常，请恢复输入后重新审核。"
      : review.error;
  return {
    id: review.id,
    status: review.status,
    composer: parseJson<ComposerDocument>(review.composerJson, []),
    snippets: parseJson<unknown[]>(review.snippetsJson, []),
    analysis: parseJson<Record<string, unknown>>(review.analysisJson, {}),
    visibleText: review.visibleText,
    runtimeText: review.runtimeText,
    error,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  const id = req.nextUrl.searchParams.get("id");
  const parsed = targetSchema.safeParse({ kind, id });
  if (!parsed.success) {
    return NextResponse.json({ error: "缺少审核目标" }, { status: 400 });
  }
  const session = await findAgentSession(parsed.data);
  if (!session) return NextResponse.json({ reviews: [] });
  const reviews = await prisma.snippetInjectionReview.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return NextResponse.json({
    reviews: dedupeActiveSnippetReviews(reviews).map(serializeReview),
  });
}

export async function POST(req: NextRequest) {
  const licenseBlocked = await requireLicenseForApi();
  if (licenseBlocked) return licenseBlocked;
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "灵感审核参数无效", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const composer = normalizeComposerDocument(
    parsed.data.composer as ComposerDocument
  );
  const serialized = composerDocumentToRuntimeText(composer);
  if (!serialized.text.trim() || serialized.snippetIds.length === 0) {
    return NextResponse.json({ error: "本轮没有可审核的灵感" }, { status: 400 });
  }

  const session = await getOrCreateAgentSession(parsed.data.target);
  const activeReviews = await prisma.snippetInjectionReview.findMany({
    where: {
      sessionId: session.id,
      status: { in: ["running", "pending"] },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const activeDuplicate = activeReviews.find((review) =>
    isSameActiveSnippetReview(review, serialized.runtimeText)
  );
  if (
    activeDuplicate &&
    isSameActiveSnippetReview(activeDuplicate, serialized.runtimeText)
  ) {
    return NextResponse.json({
      review: serializeReview(activeDuplicate),
      deduplicated: true,
    });
  }

  const rows = await prisma.snippet.findMany({
    where: { id: { in: serialized.snippetIds }, trashed: false },
    select: {
      id: true,
      title: true,
      content: true,
      kind: true,
      quoteSource: true,
      linkUrl: true,
      linkTitle: true,
      linkDescription: true,
      tagAssignments: { include: { tag: { select: { name: true } } } },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const snippets = serialized.snippetIds
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => {
      const tags = row.tagAssignments.map((item) => item.tag.name);
      return {
        id: row.id,
        title: row.title,
        content: row.content,
        kind: row.kind,
        quoteSource: row.quoteSource,
        linkUrl: row.linkUrl,
        linkTitle: row.linkTitle,
        linkDescription: row.linkDescription,
        tags,
        contentHash: fingerprintSnippet({ ...row, tags }),
      };
    });

  const applied = await prisma.snippetInjectionReview.findMany({
    where: { sessionId: session.id, status: "applied" },
    select: { snippetsJson: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const previouslyApplied = new Map<string, string>();
  for (const review of applied) {
    for (const item of parseJson<AppliedSnippetFingerprint[]>(
      review.snippetsJson,
      []
    )) {
      if (!previouslyApplied.has(item.id)) {
        previouslyApplied.set(item.id, item.contentHash);
      }
    }
  }
  const redundantIds = new Set(
    findRedundantSnippetIds(snippets, previouslyApplied)
  );

  const recentRows = await prisma.agentChatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { position: "desc" },
    take: 12,
    select: { role: true, partsJson: true },
  });
  const recentConversation = recentRows
    .reverse()
    .map((row) => {
      const parts = parseJson<Array<{ type?: string; text?: unknown }>>(
        row.partsJson,
        []
      );
      const text = parts
        .filter((part) => part.type === "text")
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("");
      return text ? `${row.role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");

  const candidates = snippets.filter((snippet) => !redundantIds.has(snippet.id));
  const hasCandidates = candidates.length > 0;
  const initialStatus = hasCandidates ? "running" : "pending";
  const initialAnalysis = {
    summary: hasCandidates
      ? "审核 Agent 正在结合本轮输入、文章与正式对话分析灵感。"
      : "所选灵感均已在此前应用过。",
    assessments: hasCandidates
      ? []
      : snippets.map((snippet) => ({
          id: snippet.id,
          title: snippet.title,
          verdict: "redundant" as const,
          score: 100,
          reason: "相同版本的灵感已经在此前正式对话中应用过。",
          suggestion: "如需再次强调，请先调整写作意图；素材内容更新后会自动重新审核。",
        })),
    progress: buildSnippetReviewProgress(initialStatus),
  };
  const review = await prisma.snippetInjectionReview.create({
    data: {
      sessionId: session.id,
      status: initialStatus,
      composerJson: JSON.stringify(composer),
      snippetsJson: JSON.stringify(
        snippets.map(({ id, title, contentHash }) => ({ id, title, contentHash }))
      ),
      analysisJson: JSON.stringify(initialAnalysis),
      visibleText: serialized.text,
      runtimeText: serialized.runtimeText,
      providerId: parsed.data.providerId,
      modelId: parsed.data.modelId,
    },
  });

  if (hasCandidates) {
    after(async () => {
      try {
        const aiAnalysis = await reviewSnippetInjectionWithAi({
          userText: serialized.text,
          currentArticle: parsed.data.currentMarkdown,
          recentConversation,
          snippets: candidates,
          providerId: parsed.data.providerId,
          modelId: parsed.data.modelId,
        });
        const aiById = new Map(
          aiAnalysis.assessments.map((item) => [item.id, item])
        );
        const assessments = snippets.map((snippet) => {
          if (redundantIds.has(snippet.id)) {
            return {
              id: snippet.id,
              title: snippet.title,
              verdict: "redundant" as const,
              score: 100,
              reason: "相同版本的灵感已经在此前正式对话中应用过。",
              suggestion:
                "如需再次强调，请先调整写作意图；素材内容更新后会自动重新审核。",
            };
          }
          const assessed = aiById.get(snippet.id);
          return {
            id: snippet.id,
            title: snippet.title,
            verdict: assessed?.verdict ?? ("insufficient" as const),
            score: assessed?.score ?? 0,
            reason: assessed?.reason ?? "审核 Agent 未返回这条素材的判断。",
            suggestion:
              assessed?.suggestion ?? "建议重新选择或补充素材使用角度。",
          };
        });
        await prisma.snippetInjectionReview.update({
          where: { id: review.id },
          data: {
            status: "pending",
            error: null,
            analysisJson: JSON.stringify({
              summary: aiAnalysis.summary,
              assessments,
              progress: buildSnippetReviewProgress("pending"),
            }),
          },
        });
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "灵感审核 Agent 执行失败";
        await prisma.snippetInjectionReview.update({
          where: { id: review.id },
          data: {
            status: "error",
            error: message,
            analysisJson: JSON.stringify({
              summary: "灵感审核未完成，本轮输入尚未进入正式写作上下文。",
              assessments: [],
              progress: buildSnippetReviewProgress("error"),
            }),
          },
        });
      }
    });
  }

  return NextResponse.json(
    { review: serializeReview(review) },
    { status: hasCandidates ? 202 : 201 }
  );
}
