import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { revealLicenseKey } from "@/lib/license/admin-service";
import { checkRateLimits, type RateLimitRule } from "@/lib/rate-limit";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

const revealSchema = z.object({
  password: z.string().min(1).max(256),
});
const REVEAL_RULE = { windowSec: 300, max: 10 } as RateLimitRule;

/** POST /api/admin/licenses/:id/reveal-key — 管理员输入查看密码后解密展示 License Key。 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const decision = checkRateLimits([
      { key: `admin:reveal-key:ip:5m:${ip}`, rule: REVEAL_RULE },
      { key: `admin:reveal-key:user:5m:${session.user.id}`, rule: REVEAL_RULE },
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
    const parsed = revealSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }

    const result = await revealLicenseKey(id, parsed.data.password, {
      id: session.user.id,
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok(result, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
