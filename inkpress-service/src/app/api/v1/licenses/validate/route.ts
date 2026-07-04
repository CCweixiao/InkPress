import { NextRequest } from "next/server";
import { validateLicenseSchema } from "@/lib/validation/schemas";
import { validateLicense } from "@/lib/license/client-service";
import { loadActivationAndVerify } from "@/lib/license/request-guard";
import { writeValidationLog } from "@/lib/license/validation-log";
import { checkRateLimits } from "@/lib/rate-limit";
import { isIpBlocked, recordSignal } from "@/lib/risk/anomaly";
import { getClientIp, readTextBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";
import type { RateLimitRule } from "@/lib/rate-limit";

// 限流（PDC §9.3）：校验 每 activation 每分钟 10 次、每 IP 每分钟 120 次
const RULES = {
  activationPerMin: { windowSec: 60, max: 10 } as RateLimitRule,
  ipPerMin: { windowSec: 60, max: 120 } as RateLimitRule,
};

/** POST /api/v1/licenses/validate — HMAC 签名 + nonce 防重放；业务态以 200+status 返回。 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  const ua = truncateUa(req.headers.get("user-agent"));

  // 风控封禁判定（优先于限流）
  const block = isIpBlocked(ip);
  if (block.blocked) {
    await writeValidationLog({
      action: "VALIDATE",
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

  let raw: string;
  try {
    raw = await readTextBody(req, {
      limitBytes: 32 * 1024,
      requireJsonContentType: true,
    });
  } catch (err) {
    return failFromError(err, requestId);
  }

  const ipDecision = checkRateLimits([
    { key: `lic:validate:ip:1m:${ip}`, rule: RULES.ipPerMin },
  ]);
  if (!ipDecision.allowed) {
    return fail(ErrorCode.RATE_LIMITED, {
      message: `请求过于频繁，请 ${ipDecision.retryAfterSec}s 后重试`,
      requestId,
      headers: { "Retry-After": String(ipDecision.retryAfterSec) },
    });
  }

  // 验签 + 加载 activation（含解密 secret、nonce 防重放）
  let verified: Awaited<ReturnType<typeof loadActivationAndVerify>>;
  try {
    verified = await loadActivationAndVerify(req, raw);
  } catch (err) {
    if (err instanceof AppError) {
      // 签名/重放失败上报风控（命中阈值后该 IP 将被临时封禁）
      if (
        err.code === ErrorCode.SIGNATURE_INVALID ||
        err.code === ErrorCode.REPLAY_DETECTED
      ) {
        recordSignal(ip, "SIGNATURE_FAILED");
      }
      await writeValidationLog({
        action: "VALIDATE",
        result: "DENIED",
        reason: err.message,
        ip,
        userAgent: ua,
      });
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }

  const actDecision = checkRateLimits([
    { key: `lic:validate:act:1m:${verified.activation.id}`, rule: RULES.activationPerMin },
  ]);
  if (!actDecision.allowed) {
    await writeValidationLog({
      action: "VALIDATE",
      result: "RATE_LIMITED",
      reason: "rate limited",
      licenseKeyId: verified.activation.licenseKeyId,
      activationId: verified.activation.id,
      ip,
      userAgent: ua,
    });
    return fail(ErrorCode.RATE_LIMITED, {
      message: `校验过于频繁，请 ${actDecision.retryAfterSec}s 后重试`,
      requestId,
      headers: { "Retry-After": String(actDecision.retryAfterSec) },
    });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return fail(ErrorCode.VALIDATION_ERROR, { message: "请求体非法", requestId });
  }
  const parsed = validateLicenseSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION_ERROR, {
      message: parsed.error.issues[0]?.message ?? "参数错误",
      details: parsed.error.issues,
      requestId,
    });
  }

  try {
    const result = await validateLicense({
      input: parsed.data,
      activation: verified.activation,
      ip,
      ua,
    });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
