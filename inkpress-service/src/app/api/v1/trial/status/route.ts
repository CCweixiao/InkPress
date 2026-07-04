import { NextRequest } from "next/server";
import { trialStatusSchema } from "@/lib/validation/schemas";
import { probeTrialStatus } from "@/lib/license/trial-service";
import { checkRateLimits } from "@/lib/rate-limit";
import { isIpBlocked } from "@/lib/risk/anomaly";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";
import type { RateLimitRule } from "@/lib/rate-limit";

// 限流：每设备每小时 1 次（与探测节奏对齐）+ 每 IP 每分钟 30 次
const RULES = {
  devicePerHour: { windowSec: 3600, max: 1 } as RateLimitRule,
  ipPerMin: { windowSec: 60, max: 30 } as RateLimitRule,
};

/** POST /api/v1/trial/status — 轻量探测（每小时一次）。 */
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
    { key: `trial:status:ip:1m:${ip}`, rule: RULES.ipPerMin },
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
    body = await readJsonBody(req, { limitBytes: 8 * 1024 });
  } catch (err) {
    return failFromError(err, requestId);
  }
  const parsed = trialStatusSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION_ERROR, {
      message: parsed.error.issues[0]?.message ?? "参数错误",
      details: parsed.error.issues,
      requestId,
    });
  }
  const input = parsed.data;

  const deviceDecision = checkRateLimits([
    { key: `trial:status:dev:1h:${input.deviceIdHash}`, rule: RULES.devicePerHour },
  ]);
  if (!deviceDecision.allowed) {
    return fail(ErrorCode.RATE_LIMITED, {
      message: `探测过于频繁，请 ${deviceDecision.retryAfterSec}s 后重试`,
      requestId,
      headers: { "Retry-After": String(deviceDecision.retryAfterSec) },
    });
  }

  try {
    const result = await probeTrialStatus({ input });
    return ok(result, { status: 200, requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
