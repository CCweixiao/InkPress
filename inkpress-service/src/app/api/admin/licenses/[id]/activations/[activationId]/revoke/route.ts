import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { revokeActivation } from "@/lib/license/admin-service";
import { checkRateLimits, type RateLimitRule } from "@/lib/rate-limit";
import { getClientIp, readOptionalJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

const ADMIN_WRITE_RULE = { windowSec: 60, max: 60 } as RateLimitRule;

/**
 * POST /api/admin/licenses/:id/activations/:activationId/revoke
 * 管理员解绑/撤销某台设备（PDC §7.2）。Phase 3 客户端激活后产生数据。
 */
export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; activationId: string }>;
  }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const decision = checkRateLimits([
      { key: `admin:activation-revoke:ip:1m:${ip}`, rule: ADMIN_WRITE_RULE },
    ]);
    if (!decision.allowed) {
      return fail(ErrorCode.RATE_LIMITED, {
        message: `请求过于频繁，请 ${decision.retryAfterSec}s 后重试`,
        requestId,
        headers: { "Retry-After": String(decision.retryAfterSec) },
      });
    }

    const { id, activationId } = await params;
    const body = await readOptionalJsonBody(req, { limitBytes: 8 * 1024 });
    const bodyObj =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { reason?: unknown })
        : undefined;
    const reason =
      typeof bodyObj?.reason === "string"
        ? bodyObj.reason.slice(0, 200)
        : undefined;
    const result = await revokeActivation(id, activationId, reason, {
      id: session.user.id,
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
