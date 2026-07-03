import { NextRequest } from "next/server";
import { activateLicenseSchema } from "@/lib/validation/schemas";
import { activateLicense } from "@/lib/license/client-service";
import { writeValidationLog } from "@/lib/license/validation-log";
import { checkRateLimits } from "@/lib/rate-limit";
import { isIpBlocked, recordSignal } from "@/lib/risk/anomaly";
import { getClientIp, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";
import type { RateLimitRule } from "@/lib/rate-limit";

// 限流（PDC §9.3）：激活 每 IP 每分钟 20 次、每 key 每小时 30 次
const RULES = {
  ipPerMin: { windowSec: 60, max: 20 } as RateLimitRule,
  keyPerHour: { windowSec: 3600, max: 30 } as RateLimitRule,
};

// 激活接口对外模糊化的状态码集合（防止 key 存在性枚举，PDC §9.4）
const BLURRED_CODES = new Set<ErrorCode>([
  ErrorCode.LICENSE_INVALID,
  ErrorCode.LICENSE_DISABLED,
  ErrorCode.LICENSE_REVOKED,
  ErrorCode.LICENSE_EXPIRED,
]);

/** POST /api/v1/licenses/activate — 首次激活无共享密钥，仅靠 HTTPS + 限流 + key 强随机性。 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  const ua = truncateUa(req.headers.get("user-agent"));

  // 风控封禁判定（优先于限流，封禁 IP 不消耗限流配额）
  const block = isIpBlocked(ip);
  if (block.blocked) {
    await writeValidationLog({
      action: "ACTIVATE",
      result: "RATE_LIMITED",
      reason: "risk:blocked",
      ip,
      userAgent: ua,
    });
    return fail(ErrorCode.RATE_LIMITED, {
      message: `请求已被风控拦截，请 ${block.retryAfterSec}s 后重试`,
      requestId,
      headers: { "Retry-After": String(block.retryAfterSec) },
    });
  }

  const ipDecision = checkRateLimits([
    { key: `lic:activate:ip:1m:${ip}`, rule: RULES.ipPerMin },
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
    body = await req.json();
  } catch {
    return fail(ErrorCode.VALIDATION_ERROR, { message: "请求体非法", requestId });
  }
  const parsed = activateLicenseSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION_ERROR, {
      message: parsed.error.issues[0]?.message ?? "参数错误",
      details: parsed.error.issues,
      requestId,
    });
  }
  const input = parsed.data;

  // 每 key 限流：失败也计数，防爆破枚举
  const keyDecision = checkRateLimits([
    { key: `lic:activate:key:1h:${input.licenseKey}`, rule: RULES.keyPerHour },
  ]);
  if (!keyDecision.allowed) {
    await writeValidationLog({
      action: "ACTIVATE",
      result: "RATE_LIMITED",
      reason: "key rate limited",
      deviceIdHash: input.device.deviceIdHash,
      ip,
      userAgent: ua,
      appVersion: input.app.version,
    });
    return fail(ErrorCode.RATE_LIMITED, {
      message: `该 License 激活过于频繁，请 ${keyDecision.retryAfterSec}s 后重试`,
      requestId,
      headers: { "Retry-After": String(keyDecision.retryAfterSec) },
    });
  }

  try {
    const result = await activateLicense({ input, ip, ua });
    return ok(result, { status: 201, requestId });
  } catch (err) {
    if (err instanceof AppError && BLURRED_CODES.has(err.code)) {
      // key 枚举/失效信号上报风控（命中阈值后该 IP 将被临时封禁）
      recordSignal(ip, "ACTIVATION_FAILED");
      return fail(ErrorCode.LICENSE_INVALID, {
        message: "License Key 无效或不可用",
        requestId,
      });
    }
    return failFromError(err, requestId);
  }
}
