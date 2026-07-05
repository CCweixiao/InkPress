import { NextRequest } from "next/server";
import { checkForUpdate } from "@/lib/release/service";
import { checkRateLimits } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode, AppError } from "@/lib/errors";
import {
  ReleasePlatformSchema,
  ReleaseChannelSchema,
  type ReleasePlatform,
  type ReleaseChannel,
} from "@/lib/validation/schemas";

/**
 * GET /api/releases/check-update?currentVersion=x&platform=y&channel=z
 *
 * 公开端点（无需登录）。客户端定期轮询「是否有新版本可用」。
 *
 * 参数：
 *   currentVersion (必填) 当前客户端版本号，如 "0.3.0"
 *   platform       (可选) 客户端平台，如 "darwin-arm64"；不传则跨平台合并取最新
 *   channel        (可选) 用户渠道，默认 stable；决定可感知的更新范围
 *
 * 限流：单 IP 30 次/分钟（客户端通常 6h 轮询一次，30/min 足够覆盖
 *       多窗口/多设备共享 IP + 用户手动触发场景）
 *
 * 返回：
 *   200 ok  { hasUpdate, currentVersion, latestVersion, ... }
 *   400     currentVersion 缺失 / 格式非法
 *   429     限流（Retry-After 头）
 */
const VERSION_RE = /^v?\d+\.\d+\.\d+[-+.\w]*$/;

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    const sp = req.nextUrl.searchParams;
    const currentVersionRaw = sp.get("currentVersion")?.trim() ?? "";
    if (!currentVersionRaw) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "缺少 currentVersion 参数",
        requestId,
      });
    }
    if (!VERSION_RE.test(currentVersionRaw)) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "currentVersion 格式不合法（期望 x.y.z）",
        requestId,
      });
    }

    const platformRaw = sp.get("platform");
    let platform: ReleasePlatform | undefined;
    if (platformRaw) {
      const parsed = ReleasePlatformSchema.safeParse(platformRaw);
      if (!parsed.success) {
        return fail(ErrorCode.VALIDATION_ERROR, {
          message: "platform 不合法",
          requestId,
        });
      }
      platform = parsed.data;
    }

    const channelRaw = sp.get("channel");
    let channel: ReleaseChannel | undefined;
    if (channelRaw) {
      const parsed = ReleaseChannelSchema.safeParse(channelRaw);
      if (!parsed.success) {
        return fail(ErrorCode.VALIDATION_ERROR, {
          message: "channel 不合法",
          requestId,
        });
      }
      channel = parsed.data;
    }

    // 限流：30 次/分钟/IP（客户端默认 6h 轮询，余量充足）
    const ip = getClientIp(req.headers);
    const decision = checkRateLimits([
      { key: `cu:ip:${ip}`, rule: { windowSec: 60, max: 30 } },
    ]);
    if (!decision.allowed) {
      return fail(ErrorCode.RATE_LIMITED, {
        message: "请求过于频繁，请稍后再试",
        details: { retryAfterSec: decision.retryAfterSec },
        requestId,
        headers: {
          "Retry-After": String(decision.retryAfterSec),
          "Cache-Control": "no-store",
        },
      });
    }

    const result = await checkForUpdate({
      currentVersion: currentVersionRaw,
      platform,
      channel,
    });

    return ok(result, {
      requestId,
      headers: {
        // 客户端默认 6h 轮询，CDN/浏览器缓存 5 分钟减少重复请求
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
