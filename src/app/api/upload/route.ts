import { NextResponse } from "next/server";
import { uploadToOss, classifyByContentType } from "@/lib/oss";
import { prisma } from "@/lib/db";
import { genAssetName, splitTagInput, tagsToJson } from "@/lib/asset";
import { syncAssetToWechat } from "@/lib/wechat/asset-sync";
import { withApiLog, logMutation } from "@/lib/api-log";
import { moduleLogger } from "@/lib/logger";

export const runtime = "nodejs";
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

const log = moduleLogger("upload.api");

/**
 * 通用文件上传：multipart/form-data 字段 file = File
 * 上传到 OSS，并落 Asset 表。
 * 字段：file(必填)、articleId?、spaceId?、description?、tags?(逗号分隔)
 *       syncToWechat?(任意非空字符串=true) — 勾选后同步到公众号素材库
 */
export const POST = withApiLog("POST /api/upload", async (req: Request) => {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择要上传的文件。" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "文件不能超过 100MB。" }, { status: 400 });
  }

  const contentType = file.type || "application/octet-stream";
  const { kind, dir } = classifyByContentType(contentType);

  // 可选归属（编辑器粘贴图片时携带）
  const articleId =
    (formData.get("articleId") as string | null) || null;
  const spaceId =
    (formData.get("spaceId") as string | null) || null;
  // 元数据：描述 / 标签（逗号分隔）
  const description = (formData.get("description") as string | null) || "";
  const tagsRaw = (formData.get("tags") as string | null) || "";
  const tagsJson = tagsToJson(splitTagInput(tagsRaw));
  // 是否同步到公众号素材库（勾选框）
  const syncToWechat = !!formData.get("syncToWechat");

  try {
    const uploaded = await uploadToOss(file, dir);
    const asset = await prisma.asset.create({
      data: {
        name: genAssetName(file.name, contentType), // 自动短 UUID 名
        ossKey: uploaded.key,
        url: uploaded.url,
        kind,
        size: uploaded.size,
        contentType: uploaded.contentType,
        description,
        tagsJson,
        articleId,
        spaceId,
      },
    });
    logMutation("asset", "create", { id: asset.id, kind, syncToWechat });

    // 同步到公众号素材库（失败不阻塞 OSS 上传，只标记状态）
    let wxSyncStatus: string | null = null;
    let wxSyncError: string | null = null;
    if (syncToWechat) {
      const result = await syncAssetToWechat({
        url: asset.url,
        contentType: asset.contentType,
        filename: asset.name,
      });
      if (result.ok) {
        await prisma.asset.update({
          where: { id: asset.id },
          data: {
            wxUrl: result.wxUrl,
            wxMediaId: result.wxMediaId,
            wxSyncStatus: "success",
            wxSyncError: null,
            wxSyncedAt: new Date(),
          },
        });
        wxSyncStatus = "success";
      } else {
        await prisma.asset.update({
          where: { id: asset.id },
          data: {
            wxSyncStatus: "failed",
            wxSyncError: result.reason,
            wxSyncedAt: new Date(),
          },
        });
        wxSyncStatus = "failed";
        wxSyncError = result.reason;
        log.warn({ id: asset.id, reason: result.reason }, "上传时同步公众号失败");
      }
    }

    return NextResponse.json({ ok: true, asset: { ...asset, wxSyncStatus, wxSyncError } });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "文件上传失败。",
      },
      { status: 400 }
    );
  }
});
