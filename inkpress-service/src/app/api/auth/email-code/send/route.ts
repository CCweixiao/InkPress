import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmailCodeSchema } from "@/lib/validation/schemas";
import { issueEmailCode } from "@/lib/email-code-service";
import { checkRateLimits } from "@/lib/rate-limit";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";
import type { RateLimitRule } from "@/lib/rate-limit";

// 限流规则（PDC §9.3 发送邮箱验证码）：严格优先
const RULES = {
  emailPer60s: { windowSec: 60, max: 1 } as RateLimitRule,
  emailPer10min: { windowSec: 600, max: 5 } as RateLimitRule,
  emailPer24h: { windowSec: 86_400, max: 20 } as RateLimitRule,
  ipPer1h: { windowSec: 3600, max: 30 } as RateLimitRule,
};

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);

  // 限流先行（按邮箱与 IP 多维度）
  let body: unknown;
  try {
    body = await readJsonBody(req, { limitBytes: 16 * 1024 });
  } catch (err) {
    return failFromError(err, requestId);
  }

  const parsed = sendEmailCodeSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION_ERROR, {
      message: parsed.error.issues[0]?.message ?? "参数错误",
      details: parsed.error.issues,
      requestId,
    });
  }
  const { email, purpose } = parsed.data;

  if (purpose !== "REGISTER" && purpose !== "RESET_PASSWORD") {
    return fail(ErrorCode.VALIDATION_ERROR, {
      message: "暂不支持的验证码用途",
      requestId,
    });
  }

  const decision = checkRateLimits([
    { key: `emailcode:email:60s:${email}`, rule: RULES.emailPer60s },
    { key: `emailcode:email:10m:${email}`, rule: RULES.emailPer10min },
    { key: `emailcode:email:24h:${email}`, rule: RULES.emailPer24h },
    { key: `emailcode:ip:1h:${ip}`, rule: RULES.ipPer1h },
  ]);
  if (!decision.allowed) {
    return fail(ErrorCode.RATE_LIMITED, {
      message: `请求过于频繁，请 ${decision.retryAfterSec}s 后重试`,
      requestId,
      headers: { "Retry-After": String(decision.retryAfterSec) },
    });
  }

  // 按用途做邮箱存在性校验，提前阻断并给出明确提示：
  // - REGISTER：邮箱已注册 → 不再发送
  // - RESET_PASSWORD：邮箱不存在 → 不再发送（避免向未知邮箱发信，同时提示用户先注册）
  const existed = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (purpose === "REGISTER" && existed) {
    return fail(ErrorCode.EMAIL_ALREADY_REGISTERED, {
      message: "该邮箱已注册，请直接登录",
      requestId,
    });
  }
  if (purpose === "RESET_PASSWORD" && !existed) {
    return fail(ErrorCode.NOT_FOUND, {
      message: "该邮箱未注册，请先注册账号",
      requestId,
    });
  }

  try {
    await issueEmailCode({
      email,
      purpose,
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok({ sent: true }, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
