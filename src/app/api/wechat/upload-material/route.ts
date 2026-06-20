import { NextRequest, NextResponse } from "next/server";
import { wxUpload, ensureOk } from "@/lib/wechat/client";
import { prisma } from "@/lib/db";
import { createHash } from "node:crypto";

/**
 * 上传图片到公众号素材库（编辑器拖拽/粘贴图片时调用）
 * - kind=body（默认）：走 media/uploadimg，返回正文图 URL
 * - kind=cover：走 material/add_material，返回 media_id（用于封面）
 *
 * 入参：multipart/form-data，字段 media = File，可选 kind、sourceUrl
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("media");
  const kind = (form.get("kind") as string) || "body";
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 media 文件" }, { status: 400 });
  }

  try {
    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    const fd = new FormData();
    fd.append("media", blob, file.name);

    if (kind === "cover") {
      const data = await wxUpload("/material/add_material", fd, {
        type: "image",
      });
      ensureOk(data, "上传封面图");
      const result = data as { media_id?: string; url?: string };
      // 若带 sourceUrl，缓存到 Material 表
      const sourceUrl = (form.get("sourceUrl") as string) || "";
      if (sourceUrl && result.media_id) {
        const hash = `cover:${createHash("sha1")
          .update(sourceUrl)
          .digest("hex")}`;
        await prisma.material.upsert({
          where: { sourceHash: hash },
          update: { wxMediaId: result.media_id, wxUrl: result.url ?? "" },
          create: {
            sourceUrl,
            sourceHash: hash,
            wxMediaId: result.media_id,
            wxUrl: result.url ?? "",
            kind: "cover",
          },
        });
      }
      return NextResponse.json({
        mediaId: result.media_id,
        url: result.url,
      });
    }

    // 正文图
    const data = await wxUpload("/media/uploadimg", fd);
    ensureOk(data, "上传正文图片");
    const url = (data as { url?: string }).url;
    if (!url) {
      return NextResponse.json({ error: "上传失败：未返回 URL" }, { status: 500 });
    }
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "上传失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
