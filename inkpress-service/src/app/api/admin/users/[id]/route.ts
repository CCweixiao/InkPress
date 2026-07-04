import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { patchUser } from "@/lib/admin/user-service";
import { patchUserSchema } from "@/lib/validation/schemas";
import { checkRateLimits, type RateLimitRule } from "@/lib/rate-limit";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

const ADMIN_WRITE_RULE = { windowSec: 60, max: 60 } as RateLimitRule;

/** PATCH /api/admin/users/:id — 禁用/启用/改角色 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const decision = checkRateLimits([
      { key: `admin:users:patch:ip:1m:${ip}`, rule: ADMIN_WRITE_RULE },
    ]);
    if (!decision.allowed) {
      return fail(ErrorCode.RATE_LIMITED, {
        message: `请求过于频繁，请 ${decision.retryAfterSec}s 后重试`,
        requestId,
        headers: { "Retry-After": String(decision.retryAfterSec) },
      });
    }

    const { id } = await params;
    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 8 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = patchUserSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }
    const user = await patchUser(
      id,
      { status: parsed.data.status, role: parsed.data.role },
      {
        id: session.user.id,
        ip,
        ua: truncateUa(req.headers.get("user-agent")),
      }
    );
    return ok(user, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
