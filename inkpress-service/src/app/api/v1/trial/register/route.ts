import { NextRequest } from "next/server";
import { trialRegisterSchema } from "@/lib/validation/schemas";
import { registerTrial } from "@/lib/license/trial-service";
import { checkRateLimits } from "@/lib/rate-limit";
import { isIpBlocked } from "@/lib/risk/anomaly";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";
import type { RateLimitRule } from "@/lib/rate-limit";

// 限流：每 IP 每分钟 20 次、每设备每天 5 次（与 activate 同维度 + 设备日限）
const RULES = {
  ipPerMin: { windowSec: 60, max: 20 } as RateLimitRule,
  devicePerDay: { windowSec: 86400, max: 5 } as RateLimitRule,
};

/** POST /api/v1/trial/register — 幂等登记试用；首次离线试用联网后锁定起点。 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  const ua = truncateUa(req.headers.get("user-agent"));

  const block = isIpBlocked(ip);
  if (block.blocked) {
    return fail(ErrorCode.RATE_LIMITED, {
      message: `请求已被风控拦截，请 ${block.retryAfterSec}s 后重试`,
      requestId,
      headers: { "Retry-After": String(block.retryAfterSec) },
    });
  }

  const ipDecision = checkRateLimits([
    { key: `trial:register:ip:1m:${ip}`, rule: RULES.ipPerMin },
  ]);
  if (!ipDecision.allowed) {
    return fail(ErrorCode.RATE_LIMITED, {
      message: `请求过于频繁，请 ${ipDecision.retryAfterSec}s 后重试`,
      requestId,
      headers: { "Retry-After": String(ipDecision.retryAfterSec) },
    });
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, { limitBytes: 32 * 1024 });
  } catch (err) {
    return failFromError(err, requestId);
  }
  const parsed = trialRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION_ERROR, {
      message: parsed.error.issues[0]?.message ?? "参数错误",
      details: parsed.error.issues,
      requestId,
    });
  }
  const input = parsed.data;

  const deviceDecision = checkRateLimits([
    { key: `trial:register:dev:1d:${input.device.deviceIdHash}`, rule: RULES.devicePerDay },
  ]);
  if (!deviceDecision.allowed) {
    return fail(ErrorCode.RATE_LIMITED, {
      message: `该设备试用登记过于频繁，请 ${deviceDecision.retryAfterSec}s 后重试`,
      requestId,
      headers: { "Retry-After": String(deviceDecision.retryAfterSec) },
    });
  }

  try {
    const result = await registerTrial({ input, ip, ua });
    return ok(result, { status: 200, requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
