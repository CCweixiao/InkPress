import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { createOrder } from "@/lib/payment/order-service";
import { createOrderSchema } from "@/lib/validation/schemas";
import { checkRateLimits, type RateLimitRule } from "@/lib/rate-limit";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

const ORDER_CREATE_PER_MIN: RateLimitRule = { windowSec: 60, max: 5 };
const ORDER_CREATE_PER_HOUR: RateLimitRule = { windowSec: 3600, max: 30 };

/** POST /api/orders — 创建订单 + 调 alipay.trade.wap.pay 拿跳转 URL */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) {
      return fail(ErrorCode.UNAUTHORIZED, { message: "请先登录", requestId });
    }

    const decision = checkRateLimits([
      {
        key: `order:create:user:1m:${session.user.id}`,
        rule: ORDER_CREATE_PER_MIN,
      },
      {
        key: `order:create:user:1h:${session.user.id}`,
        rule: ORDER_CREATE_PER_HOUR,
      },
    ]);
    if (!decision.allowed) {
      return fail(ErrorCode.RATE_LIMITED, {
        message: `下单过于频繁，请 ${decision.retryAfterSec}s 后重试`,
        requestId,
        headers: { "Retry-After": String(decision.retryAfterSec) },
      });
    }

    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 8 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }

    const result = await createOrder({
      planSlug: parsed.data.planSlug,
      userId: session.user.id,
      userEmail: session.user.email,
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok(result, { status: 201, requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
