import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import {
  listAllPlans,
  createPlan,
} from "@/lib/plan/plan-service";
import { createPlanSchema } from "@/lib/validation/schemas";
import { checkRateLimits, type RateLimitRule } from "@/lib/rate-limit";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

const WRITE_RULE = { windowSec: 60, max: 30 } as RateLimitRule;

/** GET /api/admin/plans — 全部计划（含 INACTIVE），管理端用 */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const items = await listAllPlans();
    return ok({ items }, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

/** POST /api/admin/plans — 新建订阅计划 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const decision = checkRateLimits([
      { key: `admin:plans:post:ip:1m:${ip}`, rule: WRITE_RULE },
    ]);
    if (!decision.allowed) {
      return fail(ErrorCode.RATE_LIMITED, {
        message: `请求过于频繁，请 ${decision.retryAfterSec}s 后重试`,
        requestId,
        headers: { "Retry-After": String(decision.retryAfterSec) },
      });
    }

    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 32 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = createPlanSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }

    const created = await createPlan(parsed.data, {
      id: session.user.id,
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok(created, { status: 201, requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
