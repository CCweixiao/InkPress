import { NextRequest, NextResponse } from "next/server";
import { incrementDownloadCount } from "@/lib/release/service";
import { checkRateLimits } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/http";
import { AppError, ErrorCode } from "@/lib/errors";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("release");

/**
 * GET /api/releases/:id/download
 *
 * 公开下载跟踪端点（无需登录）。
 * 流程：
 *   1. IP 提取（X-Forwarded-For / x-real-ip）
 *   2. 双层限流：
 *      - 单 IP 全局 10 次/分钟（防脚本高频刷）
 *      - 单 IP + 同版本 3 次/5 分钟（防针对单版本刷计数）
 *   3. 计数幂等：同 IP + 同版本 30 分钟内只 +1
 *   4. 签名 OSS URL（10 分钟有效，private bucket 必需）
 *   5. 302 跳转
 *
 * 安全设计：
 * - 真实 OSS 直链不出现在前端 HTML（前端只拿 /api/releases/[id]/download）
 * - 302 的 Location 是 10 分钟签名 URL，过期后 403，攻击者必须再打本端点
 * - 再打本端点 → 被限流拦截 → OSS 流量无法被刷
 *
 * HIDDEN / 不存在 → 404
 * 命中限流 → 429 + Retry-After
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ip = getClientIp(req.headers);

    // 1. 双层限流
    const decision = checkRateLimits([
      // 全局：单 IP 每分钟最多 10 次下载请求（任何版本合计）
      { key: `dl:ip:${ip}`, rule: { windowSec: 60, max: 10 } },
      // 针对性：单 IP 对同一版本每 5 分钟最多 3 次（允许重试，防刷量）
      { key: `dl:rel:${id}:${ip}`, rule: { windowSec: 300, max: 3 } },
    ]);
    if (!decision.allowed) {
      return new NextResponse(
        JSON.stringify({
          error: {
            code: "RATE_LIMITED",
            message: "下载请求过于频繁，请稍后再试",
            retryAfterSec: decision.retryAfterSec,
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(decision.retryAfterSec),
            "Cache-Control": "no-store",
          },
        }
      );
    }

    // 2. 计数（带幂等）+ 签名 URL
    const signedUrl = await incrementDownloadCount(id, ip);

    // 3. 302 跳转到签名 URL
    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers: {
        // no-store 防止 CDN/代理缓存导致签名 URL 被复用（签名虽然过期会 403，
        // 但缓存层可能不检查 OSS 的 403，仍然返回缓存的 302）
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof AppError && err.code === ErrorCode.NOT_FOUND) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "版本不存在或已下架" } },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }
    log.warn({ err }, "下载跟踪端点异常");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "下载服务暂不可用" } },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
