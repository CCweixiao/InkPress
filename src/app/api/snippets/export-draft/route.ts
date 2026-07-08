import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeContentAt, articleFilePath } from "@/lib/content-store";
import { composeDraftBody, deriveDraftTitle } from "@/lib/snippets/draft-export";
import { withApiLog, logMutation } from "@/lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
});

/** 多选素材 → 一键导出为新 draft Article（正文按选择序 --- 分隔）+ SnippetUsage 溯源。 */
export const POST = withApiLog(
  "POST /api/snippets/export-draft",
  async (req: NextRequest) => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "ids 参数无效（需 1-50 条）" },
        { status: 400 }
      );
    }
    const ids = [...new Set(parsed.data.ids)]; // 去重保选择序首现

    // findMany 不保序 → 按入参 ids 顺序重排；丢弃不存在/已删
    const found = await prisma.snippet.findMany({
      where: { id: { in: ids }, trashed: false },
    });
    const byId = new Map(found.map((s) => [s.id, s]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((s): s is (typeof found)[number] => !!s);

    if (ordered.length === 0) {
      return NextResponse.json({ error: "没有可导出的素材" }, { status: 400 });
    }

    const markdown = composeDraftBody(ordered);
    const title = deriveDraftTitle(ordered);

    // 默认 theme（镜像 /api/articles POST）
    const defaultTheme =
      (await prisma.theme.findFirst({ where: { isDefault: true } })) ??
      (await prisma.theme.findFirst({ where: { isBuiltIn: true } }));
    const themeId = defaultTheme?.id ?? null;

    // 先建 Article 拿 id，再落盘正文
    const article = await prisma.article.create({
      data: { title, themeId, status: "draft" },
    });
    const contentPath = articleFilePath({ articleId: article.id, spaceId: null });
    try {
      await writeContentAt(contentPath, markdown);
      await prisma.article.update({
        where: { id: article.id },
        data: { contentPath },
      });
    } catch (e) {
      // 正文落盘失败：回滚 Article，避免空壳文章
      await prisma.article.delete({ where: { id: article.id } }).catch(() => {});
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "正文落盘失败" },
        { status: 500 }
      );
    }

    // SnippetUsage 双向溯源。新文章 + ids 已去重 → (snippetId, articleId) 必唯一，
    // 无需 skipDuplicates（SQLite createMany 不支持）。溯源写失败不阻断。
    await prisma.snippetUsage
      .createMany({
        data: ordered.map((s) => ({
          snippetId: s.id,
          articleId: article.id,
          insertedVia: "export",
        })),
      })
      .catch(() => {
        /* 溯源缺失不阻断 */
      });

    logMutation("article", "create", {
      id: article.id,
      title: article.title,
      via: "snippets-export",
      snippetCount: ordered.length,
    });

    return NextResponse.json({ articleId: article.id }, { status: 201 });
  }
);
