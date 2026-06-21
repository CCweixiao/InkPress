import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/provider";
import { prisma } from "@/lib/db";
import { readContent } from "@/lib/content-store";

export const runtime = "nodejs";

const schema = z.object({
  articleId: z.string().min(1),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
});

/**
 * 基于文章正文生成 ≤120 字摘要（公众号 digest）。
 * 生成后写回 Article.digest。
 */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "缺少 articleId" }, { status: 400 });
  }

  const article = await prisma.article.findUnique({
    where: { id: parsed.data.articleId },
  });
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  const markdown = article.contentPath
    ? await readContent(article.id)
    : (article.contentMd ?? "");
  if (!markdown.trim()) {
    return NextResponse.json({ error: "文章内容为空，无法生成摘要" }, { status: 400 });
  }

  let model;
  try {
    model = (await getModel(parsed.data.providerId, parsed.data.modelId)).model;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "模型加载失败" },
      { status: 500 }
    );
  }

  try {
    const { text } = await generateText({
      model,
      system:
        "你是公众号摘要生成助手。请为文章生成一段不超过 120 字的摘要，用于公众号文章列表展示。要求：概括核心观点，语言精炼有吸引力，不要使用「本文介绍了」这类机械开头，不要换行，直接输出摘要文本，不要任何前后缀或解释。",
      prompt: `【文章正文】\n${markdown.slice(0, 4000)}\n\n请生成 ≤120 字摘要：`,
    });

    const digest = text.replace(/\s+/g, " ").trim().slice(0, 120);
    await prisma.article.update({
      where: { id: article.id },
      data: { digest },
    });
    return NextResponse.json({ digest });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "摘要生成失败" },
      { status: 500 }
    );
  }
}
