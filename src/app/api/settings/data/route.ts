import { NextResponse } from "next/server";
import { buildDataExportZip } from "@/lib/data-portability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/settings/data
 * 下载数据导出包（zip）：完整 inkpressHome，排除 cache/logs/重置标记。
 * 含 .secret（包内 DB 的 key 随包迁移）；请妥善保管。
 */
export async function GET() {
  try {
    const buf = buildDataExportZip();
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="inkpress-data.zip"',
        "Content-Length": String(buf.byteLength),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "导出失败" },
      { status: 500 }
    );
  }
}
