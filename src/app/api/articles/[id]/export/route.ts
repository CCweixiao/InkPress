import { NextRequest, NextResponse } from "next/server";
import { withApiLog } from "@/lib/api-log";
import {
  ArticleExportTooLargeError,
  exportArticleToZip,
} from "@/lib/article-portability-service";
import { requireLicenseForApi } from "@/lib/license/guard";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * 导出文章为 ZIP（正文 MD + 元数据 + 素材，本地素材含二进制）。
 * 薄适配：读 body 里的屏幕最新 contentMd → 调服务打包 → 返回 blob。业务逻辑在服务层。
 */
export const POST = withApiLog(
  "POST /api/articles/[id]/export",
  async (req: NextRequest, { params }: Params) => {
    try {
      const licenseBlocked = await requireLicenseForApi();
      if (licenseBlocked) return licenseBlocked;
      const { id } = await params;
      const body = await req.json().catch(() => ({}));
      const contentMd =
        typeof body?.contentMd === "string" ? body.contentMd : undefined;
      const includeAssets = body?.includeAssets !== false;
      const result = await exportArticleToZip({
        articleId: id,
        contentMd,
        includeAssets,
      });
      if (!result) {
        return NextResponse.json({ error: "文章不存在。" }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(result.zip), {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        },
      });
    } catch (err) {
      if (err instanceof ArticleExportTooLargeError) {
        return NextResponse.json({ error: err.message }, { status: 413 });
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "导出失败。" },
        { status: 500 }
      );
    }
  }
);
