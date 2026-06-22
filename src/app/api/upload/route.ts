import { NextResponse } from "next/server";
import { uploadToOss, classifyByContentType } from "@/lib/oss";
import { prisma } from "@/lib/db";
import { genAssetName, splitTagInput, tagsToJson } from "@/lib/asset";
import { withApiLog } from "@/lib/api-log";

export const runtime = "nodejs";
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * 通用文件上传：multipart/form-data 字段 file = File
 * 上传到 OSS，并落 Asset 表。
 * 字段：file(必填)、articleId?、spaceId?、description?、tags?(逗号分隔)
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
    return NextResponse.json({ ok: true, asset });
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
