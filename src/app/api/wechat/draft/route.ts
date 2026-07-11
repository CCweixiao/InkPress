import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { convertToWeChat } from "@/lib/convert/to-wechat";
import { uploadBodyImage } from "@/lib/wechat/material";
import { addDraft, updateDraft } from "@/lib/wechat/draft";
import { readContentAt } from "@/lib/content-store";
import { readStorageObjectBuffer } from "@/lib/storage";
import { moduleLogger } from "@/lib/logger";
import { withApiLog } from "@/lib/api-log";
import { requireLicenseForApi } from "@/lib/license/guard";

const log = moduleLogger("wechat.draft.api");

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
export const POST = withApiLog("POST /api/wechat/draft", async (req: NextRequest) => {
  const licenseBlocked = await requireLicenseForApi();
  if (licenseBlocked) return licenseBlocked;
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
  const themeId = parsed.data.themeId ?? article.themeId;
  const theme = themeId
    ? await prisma.theme.findUnique({ where: { id: themeId } })
    : await prisma.theme.findFirst({ where: { isBuiltIn: true } });
  if (!theme) {
    return NextResponse.json({ error: "未找到排版主题" }, { status: 400 });
  }

  // 服务端 fetcher（下载外链图片，带超时与大小限制，避免卡死或超大文件）
  // 每个失败分支都记 warn：图片下载失败是公众号图片缺失的最常见根因，
  // 之前被上层 .catch(()=>null) 吞掉，现在这里留下明确日志。
  const fetcher = async (url: string): Promise<ArrayBuffer> => {
    // 本地存储对象（/api/storage/<id>）：服务端 fetch 无法解析相对 URL，
    // 直接从磁盘读取（readStorageObjectBuffer 已含路径越界防护）
    const localMatch = url.match(/^\/api\/storage\/(.+)$/);
    if (localMatch) {
      const id = decodeURIComponent(localMatch[1]);
      const buf = await readStorageObjectBuffer(id);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; WePaperBot/1.0)" },
      });
      if (!res.ok) {
        log.warn({ url, status: res.status }, "下载外链图片失败（HTTP 非 2xx）");
        throw new Error(`下载图片失败：${url}（${res.status}）`);
      }
      const buf = await res.arrayBuffer();
      // 限制 10MB（微信单图上限约 10MB）
      if (buf.byteLength > 10 * 1024 * 1024) {
        log.warn(
          { url, sizeMb: +(buf.byteLength / 1024 / 1024).toFixed(1) },
          "外链图片超出 10MB 上限"
        );
        throw new Error(`图片过大（${(buf.byteLength / 1024 / 1024).toFixed(1)}MB）：${url}`);
      }
      return buf;
    } catch (e) {
      // abort（超时）与网络错误在此统一记 warn；上面已记的 HTTP/超大分支不会重复
      if (e instanceof Error && !/下载图片失败|图片过大/.test(e.message)) {
        log.warn({ url, err: e.message }, "下载外链图片异常（超时或网络错误）");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    // 正文从文件读取（回退 contentMd 列兼容旧数据）
    const markdown = article.contentPath
      ? await readContentAt(article.contentPath)
      : (article.contentMd ?? "");
    // 2. 转换（含图片上传替换；failedImages 为上传失败的外链，原样保留在 HTML 中）
    const { html, failedImages } = await convertToWeChat(
      markdown,
      {
        cssContent: theme.cssContent,
        codeTheme: theme.codeTheme,
        primaryColor: theme.primaryColor ?? "#3f51b5",
      },
      { uploadImage: (url) => uploadBodyImage(url, fetcher) }
    );
    if (failedImages.length > 0) {
      log.warn(
        { articleId, count: failedImages.length, urls: failedImages.map((f) => f.url) },
        "部分正文图片上传失败，将以原外链推送（公众号可能因防盗链裂图）"
      );
    }

    // 3. 封面
    const thumbMediaId = article.coverMediaId ?? "";
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
        failedImages,
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
      failedImages,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "推送失败";
    log.error({ err: e, articleId }, "推送公众号草稿失败");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
