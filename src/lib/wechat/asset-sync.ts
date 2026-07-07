import { wxUpload, ensureOk } from "./client";
import { hasWechatConfig } from "./config";
import { backfillMaterialCache } from "./material";
import { ensureWechatCompatibleImage } from "./svg-to-png";
import { classifyByContentType } from "@/lib/oss";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("wechat.asset-sync");

/** 同步结果：成功带 url/mediaId，失败带 reason */
export type SyncResult =
  | { ok: true; wxUrl: string | null; wxMediaId: string | null }
  | { ok: false; reason: string };

/** 未配置公众号凭证时的标准错误文案 */
export const WX_NOT_CONFIGURED = "未配置微信公众号凭证，请在「设置 → 微信公众号」中填写 appId 与 secret";

/**
 * 把一个已上传到 OSS 的素材同步到微信公众号素材库。
 *
 * - 图片（image）：走 media/uploadimg，返回正文图 URL
 * - 视频/文件：走 material/add_material（type=video/image），返回 media_id
 *
 * 调用方负责把结果写入 Asset 表（wxSyncStatus / wxUrl / wxMediaId / wxSyncError / wxSyncedAt）。
 * 这里只做"上传"动作，不碰 DB，便于在多个入口（上传时/重试时）复用。
 */
export async function syncAssetToWechat(params: {
  url: string; // OSS 可访问 URL
  contentType: string; // mime
  filename: string;
}): Promise<SyncResult> {
  if (!(await hasWechatConfig())) {
    return { ok: false, reason: WX_NOT_CONFIGURED };
  }

  const start = Date.now();
  try {
    // 1. 从 OSS 下载
    const dlRes = await fetch(params.url, { signal: AbortSignal.timeout(30_000) });
    if (!dlRes.ok) {
      throw new Error(`下载素材失败：HTTP ${dlRes.status}`);
    }
    const buf = await dlRes.arrayBuffer();
    // 微信单文件上限约 10MB（图片）/ 200MB（视频），此处统一卡 10MB 避免超大文件卡死
    if (buf.byteLength > 10 * 1024 * 1024) {
      throw new Error(
        `素材过大（${(buf.byteLength / 1024 / 1024).toFixed(1)}MB），超过 10MB 上限`
      );
    }

    // 第二层兜底：SVG → PNG（公众号不支持 SVG）。用转换后的 MIME 判 kind
    const { buf: wxBuf, contentType: wxType, filename: wxFilename } =
      await ensureWechatCompatibleImage({
        buf,
        contentType: params.contentType,
        filename: params.filename,
      });
    const blob = new Blob([wxBuf], { type: wxType });
    const form = new FormData();
    form.append("media", blob, wxFilename);
    const { kind } = classifyByContentType(wxType);

    // 2. 图片走 uploadimg（返回正文图 URL），其余走 add_material（返回 media_id）
    if (kind === "image") {
      const data = await wxUpload("/media/uploadimg", form);
      ensureOk(data, "同步素材到公众号");
      const wxUrl = (data as { url?: string }).url ?? null;
      // 回填 Material 缓存：让后续文章渲染命中一级缓存、不重复上传
      if (wxUrl) {
        await backfillMaterialCache(params.url, wxUrl).catch(() => {});
      }
      log.info(
        { wxUrl, size: wxBuf.byteLength, durationMs: Date.now() - start },
        "素材已同步到公众号（正文图）"
      );
      return { ok: true, wxUrl, wxMediaId: null };
    }

    // 视频 / 文件 → 永久素材
    const materialType = kind === "video" ? "video" : "image";
    const data = await wxUpload("/material/add_material", form, { type: materialType });
    ensureOk(data, "同步素材到公众号");
    const result = data as { media_id?: string; url?: string };
    log.info(
      { mediaId: result.media_id, kind, durationMs: Date.now() - start },
      "素材已同步到公众号（永久素材）"
    );
    return {
      ok: true,
      wxUrl: result.url ?? null,
      wxMediaId: result.media_id ?? null,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "同步失败";
    log.warn({ url: params.url, reason, durationMs: Date.now() - start }, "素材同步公众号失败");
    return { ok: false, reason };
  }
}

/**
 * 把同步结果写回 Asset 表。
 * 成功：清空 error，填 url/mediaId/status=success/syncedAt
 * 失败：填 error/status=failed/syncedAt（保留旧的 url/mediaId 不动）
 */
export async function persistSyncResult(
  assetId: string,
  result: SyncResult
): Promise<void> {
  if (result.ok) {
    await prisma.asset.update({
      where: { id: assetId },
      data: {
        wxUrl: result.wxUrl,
        wxMediaId: result.wxMediaId,
        wxSyncStatus: "success",
        wxSyncError: null,
        wxSyncedAt: new Date(),
      },
    });
  } else {
    await prisma.asset.update({
      where: { id: assetId },
      data: {
        wxSyncStatus: "failed",
        wxSyncError: result.reason,
        wxSyncedAt: new Date(),
      },
    });
  }
}
