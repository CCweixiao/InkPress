import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { renderInlineHtml } from "@/lib/convert/render-inline";
import {
  getFinalize,
  resolveFinalizeChannelId,
} from "@/lib/publish/channels/finalize";
import { readContentAt } from "@/lib/content-store";

/**
 * 服务端渲染预览：markdown → 按渠道产出 inline HTML
 *
 * 默认 channel="wechat"（与重构前行为一致：renderInlineHtml + finalizeForWeChat）。
 * 传 channel=zhihu/juejin/bokeyuan/generic 则产出对应渠道可粘贴的 HTML
 * （通用导出渠道仅做无害清洗，保留原生列表与锚点）。
 *
 * 预览一律不上传图片（即使 channel=wechat），与正式推送草稿箱的唯一差异是图片上传。
 *
 * POST { articleId?, markdown, themeId?, theme?, channel? } → { html, channel }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    articleId,
    markdown,
    themeId,
    theme: inlineTheme,
    channel: channelId,
  } = body as {
    articleId?: string;
    markdown?: string;
    themeId?: string | null;
    theme?: {
      cssContent: string;
      codeTheme: string;
      primaryColor?: string | null;
    };
    channel?: string;
  };

  // 取 markdown 源（优先正文文件，回退 contentMd 列）
  let md = markdown ?? "";
  if (!md && articleId) {
    const article = await prisma.article.findUnique({ where: { id: articleId } });
    md = article?.contentPath
      ? await readContentAt(article.contentPath)
      : (article?.contentMd ?? "");
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
  const theme = inlineTheme?.cssContent
    ? inlineTheme
    : themeIdResolved
      ? await prisma.theme.findUnique({ where: { id: themeIdResolved } })
      : await prisma.theme.findFirst({ where: { isBuiltIn: true } });

  if (!theme) {
    return NextResponse.json({ error: "未找到主题" }, { status: 400 });
  }

  // 取渠道 finalize（默认 wechat；未知 id 兜底 wechat，保证向后兼容）
  const channelIdResolved = resolveFinalizeChannelId(channelId ?? "wechat");
  const finalize = getFinalize(channelIdResolved);

  // 通用渲染（markdown-it + 主题 CSS + juice 全内联）+ 渠道后处理
  const primaryColor = theme.primaryColor ?? "#3f51b5";
  const { html: inlined } = await renderInlineHtml(md, {
    cssContent: theme.cssContent,
    codeTheme: theme.codeTheme,
    primaryColor,
  });
  const html = finalize(inlined, primaryColor);

  return NextResponse.json({ html, channel: channelIdResolved });
}
