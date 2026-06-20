import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { convertToWeChat } from "@/lib/convert/to-wechat";
import { uploadBodyImage } from "@/lib/wechat/material";
import { addDraft } from "@/lib/wechat/draft";

const schema = z.object({
  articleId: z.string(),
  themeId: z.string().nullable().optional(),
  digest: z.string().max(200).optional(),
  author: z.string().optional(),
});

/**
 * 推送文章到公众号草稿箱：
 * 1. 取文章 + 主题
 * 2. convertToWeChat 全流水线转换（含图片外链→wx_src 上传替换）
 * 3. 取封面 media_id（优先文章已存的 coverMediaId）
 * 4. addDraft 推送
 * 5. 写回 wxMediaId + status=pushed
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { articleId, digest, author } = parsed.data;

  // 1. 取文章 + 主题
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  let themeId = parsed.data.themeId ?? article.themeId;
  const theme = themeId
    ? await prisma.theme.findUnique({ where: { id: themeId } })
    : await prisma.theme.findFirst({ where: { isBuiltIn: true } });
  if (!theme) {
    return NextResponse.json({ error: "未找到排版主题" }, { status: 400 });
  }

  // 服务端 fetcher（用于下载外链图片上传到微信）
  const fetcher = async (url: string): Promise<ArrayBuffer> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载图片失败：${url}`);
    return res.arrayBuffer();
  };

  try {
    // 2. 转换（含图片上传替换）
    const { html } = await convertToWeChat(
      article.contentMd,
      {
        cssContent: theme.cssContent,
        codeTheme: theme.codeTheme,
        primaryColor: theme.primaryColor ?? "#3f51b5",
      },
      { uploadImage: (url) => uploadBodyImage(url, fetcher) }
    );

    // 3. 封面
    let thumbMediaId = article.coverMediaId ?? "";
    if (!thumbMediaId) {
      // 无封面时使用一张占位：从正文第一张图取，否则跳过封面（公众号要求必须有封面）
      return NextResponse.json(
        { error: "缺少封面图。请先在编辑器中为文章设置封面。" },
        { status: 400 }
      );
    }

    // 4. 推送草稿
    const finalDigest =
      digest ||
      article.digest ||
      article.contentMd.slice(0, 54).replace(/[#*`>\-\n]/g, "").trim();
    const mediaId = await addDraft({
      title: article.title || "无标题文章",
      content: html,
      thumb_media_id: thumbMediaId,
      author: author || "墨笔",
      digest: finalDigest,
    });

    // 5. 写回
    await prisma.article.update({
      where: { id: articleId },
      data: { wxMediaId: mediaId, status: "pushed", themeId: theme.id },
    });

    return NextResponse.json({
      message: "已推送到公众号草稿箱",
      mediaId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "推送失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
