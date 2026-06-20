import { wxJson, ensureOk } from "./client";

export type DraftArticle = {
  title: string;
  content: string; // 微信 HTML（图片须为 wx_src URL）
  thumb_media_id: string; // 封面 media_id（来自 add_material）
  author?: string;
  digest?: string; // 摘要 ≤120 字
  content_source_url?: string; // 原文链接（可空）
  need_open_comment?: 0 | 1;
  only_fans_can_comment?: 0 | 1;
};

/**
 * 新增草稿（cgi-bin/draft/add）
 * 返回 media_id（即草稿箱 id，群发/发布后从草稿箱移除，也可在后台草稿箱查看）
 * 仅推送到草稿箱；正式发布由用户在公众号后台手动操作（按需求决策）。
 */
export async function addDraft(article: DraftArticle): Promise<string> {
  const data = await wxJson("/draft/add", { articles: [article] });
  ensureOk(data, "新增草稿");
  const mediaId = (data as { media_id?: string }).media_id;
  if (!mediaId) throw new Error("新增草稿失败：未返回 media_id");
  return mediaId;
}
