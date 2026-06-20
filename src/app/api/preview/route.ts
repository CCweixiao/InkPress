import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { convertToWeChat } from "@/lib/convert/to-wechat";

/**
 * 服务端完整转换预览：markdown → 公众号 inline HTML
 * 用于发布前核对最终效果（与实际推送进草稿箱的内容一致，但不上传图片）。
 *
 * POST { articleId?, markdown, themeId? } → { html }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { articleId, markdown, themeId } = body as {
    articleId?: string;
    markdown?: string;
    themeId?: string | null;
  };

  // 取 markdown 源
  let md = markdown ?? "";
  if (!md && articleId) {
    const article = await prisma.article.findUnique({ where: { id: articleId } });
    md = article?.contentMd ?? "";
  }
  if (!md.trim()) {
    return NextResponse.json({ error: "无内容可预览" }, { status: 400 });
  }

  // 取主题
  let themeIdResolved = themeId;
  if (!themeIdResolved && articleId) {
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: { themeId: true },
    });
    themeIdResolved = article?.themeId ?? null;
  }
  const theme = themeIdResolved
    ? await prisma.theme.findUnique({ where: { id: themeIdResolved } })
    : await prisma.theme.findFirst({ where: { isBuiltIn: true } });

  if (!theme) {
    return NextResponse.json({ error: "未找到主题" }, { status: 400 });
  }

  // 转换（预览不实际上传图片）
  const { html } = await convertToWeChat(md, {
    cssContent: theme.cssContent,
    codeTheme: theme.codeTheme,
    primaryColor: theme.primaryColor ?? "#3f51b5",
  });

  return NextResponse.json({ html });
}
