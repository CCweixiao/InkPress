import { NextResponse } from "next/server";
import { classifyByContentType } from "@/lib/oss";
import { prisma } from "@/lib/db";
import { genAssetName, splitTagInput, tagsToJson } from "@/lib/asset";
import { syncAssetToWechat } from "@/lib/wechat/asset-sync";
import { isSvg, convertSvgToPng } from "@/lib/wechat/svg-to-png";
import { withApiLog, logMutation } from "@/lib/api-log";
import { moduleLogger } from "@/lib/logger";
import { originalFilenameMetadata, putBufferObject } from "@/lib/storage";

export const runtime = "nodejs";
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

const log = moduleLogger("upload.api");

/**
 * 通用文件上传：multipart/form-data 字段 file = File
 * 写入统一存储层，并落 Asset 表。
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
  // 第一层：SVG → PNG 开关。与 syncToWechat 绑定：
  //   显式传值则尊重；未传时跟随 syncToWechat（同步则转，不同步则保留原始 SVG）
  const rawFlag = formData.get("convertSvgToPng");
  const shouldConvertSvg =
    rawFlag === null
      ? syncToWechat
      : !["0", "false", "no"].includes(String(rawFlag).toLowerCase());

  try {
    // 第一层转换：SVG → PNG（公众号素材库不支持 SVG）
    let uploadBuffer: Buffer = Buffer.from(await file.arrayBuffer());
    let uploadContentType = contentType;
    let uploadFilename = file.name;
    let convertedFromSvg = false;
    if (shouldConvertSvg && isSvg(uploadContentType, uploadFilename)) {
      try {
        uploadBuffer = await convertSvgToPng(uploadBuffer);
        uploadContentType = "image/png";
        uploadFilename = uploadFilename.replace(/\.svgz?$/i, ".png");
        convertedFromSvg = true;
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "SVG 转 PNG 失败" },
          { status: 400 }
        );
      }
    }

    const { kind, dir } = classifyByContentType(uploadContentType);

    const storageObject = await putBufferObject({
      buffer: uploadBuffer,
      filename: uploadFilename,
      contentType: uploadContentType,
      kind: dir,
      articleId,
      spaceId,
      metadata: {
        ...originalFilenameMetadata(file.name),
        ...(convertedFromSvg ? { convertedFromSvg: true } : {}),
      },
      preferCloud: true,
    });
    const asset = await prisma.asset.create({
      data: {
        name: genAssetName(uploadFilename, uploadContentType), // 自动短 UUID 名
        ossKey: storageObject.key,
        url: storageObject.url ?? `/api/storage/${storageObject.id}`,
        kind,
        size: storageObject.size,
        contentType: storageObject.contentType,
        storageObjectId: storageObject.id,
        metadataJson: storageObject.metadataJson,
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
