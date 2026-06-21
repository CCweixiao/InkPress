import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { convertToWeChat } from "@/lib/convert/to-wechat";
import { uploadBodyImage } from "@/lib/wechat/material";
import { addDraft, updateDraft } from "@/lib/wechat/draft";
import { readContent } from "@/lib/content-store";

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

  // 服务端 fetcher（下载外链图片，带超时与大小限制，避免卡死或超大文件）
  const fetcher = async (url: string): Promise<ArrayBuffer> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; WePaperBot/1.0)" },
      });
      if (!res.ok) throw new Error(`下载图片失败：${url}（${res.status}）`);
      const buf = await res.arrayBuffer();
      // 限制 10MB（微信单图上限约 10MB）
      if (buf.byteLength > 10 * 1024 * 1024) {
        throw new Error(`图片过大（${(buf.byteLength / 1024 / 1024).toFixed(1)}MB）：${url}`);
      }
      return buf;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    // 正文从文件读取（回退 contentMd 列兼容旧数据）
    const markdown = article.contentPath
      ? await readContent(article.id)
      : (article.contentMd ?? "");
    // 2. 转换（含图片上传替换）
    const { html } = await convertToWeChat(
      markdown,
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

    // 4. 推送草稿：已有 wxMediaId 则更新（覆盖修改），否则新增
    const finalDigest =
      digest ||
      article.digest ||
      markdown.slice(0, 54).replace(/[#*`>\-\n]/g, "").trim();
    const draftArticle = {
      title: article.title || "无标题文章",
      content: html,
      thumb_media_id: thumbMediaId,
      author: author || "InkPress",
      digest: finalDigest,
    };

    const existedMediaId = article.wxMediaId;
    if (existedMediaId) {
      // 重复发布 = 更新已有草稿（单图文 index 恒为 0）
      await updateDraft(existedMediaId, 0, draftArticle);
      await prisma.article.update({
        where: { id: articleId },
        data: { status: "pushed", themeId: theme.id },
      });
      return NextResponse.json({
        message: "已更新公众号草稿箱中的文章",
        mediaId: existedMediaId,
        updated: true,
      });
    }

    // 首次发布 = 新增草稿
    const mediaId = await addDraft(draftArticle);
    await prisma.article.update({
      where: { id: articleId },
      data: { wxMediaId: mediaId, status: "pushed", themeId: theme.id },
    });
    return NextResponse.json({
      message: "已推送到公众号草稿箱",
      mediaId,
      updated: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "推送失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
