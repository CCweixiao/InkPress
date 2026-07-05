import { NextRequest, NextResponse } from "next/server";
import { incrementDownloadCount } from "@/lib/release/service";
import { AppError, ErrorCode } from "@/lib/errors";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("release");

/**
 * GET /api/releases/:id/download
 *
 * 公开下载跟踪端点（无需登录）。
 * 流程：原子自增 downloadCount → 302 跳转到真实 OSS URL。
 * HIDDEN / 不存在 → 404。
 *
 * Cache-Control: no-store 防止 CDN/代理缓存导致计数丢失。
 * 浏览器/Arc/aria2 等下载器跟随 302 后由 OSS 直接提供文件。
 *
 * 安全考虑：
 * - id 为 cuid，枚举空间足够；不加 IP 限流（计数膨胀攻击代价远高于收益）
 * - 真实 OSS 直链不暴露在前端 HTML 中，降低 OSS bucket 被刷流量的风险
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const realUrl = await incrementDownloadCount(id);
    return NextResponse.redirect(realUrl, {
      status: 302,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        // 让浏览器把后续下载当成附件（fileName 由 OSS Content-Disposition 决定更佳）
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof AppError && err.code === ErrorCode.NOT_FOUND) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "版本不存在或已下架" } },
        { status: 404 }
      );
    }
    log.warn({ err }, "下载跟踪端点异常");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "下载服务暂不可用" } },
      { status: 500 }
    );
  }
}
