import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resetPasswordSchema } from "@/lib/validation/schemas";
import { consumeEmailCode } from "@/lib/email-code-service";
import { hashPassword, validatePasswordPolicy } from "@/lib/security/password";
import { checkRateLimits } from "@/lib/rate-limit";
import { getClientIp, readJsonBody } from "@/lib/http";
import { moduleLogger } from "@/lib/logger";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

const log = moduleLogger("password-reset");

// 重置密码限流：每 IP 每小时 20 次
const RESET_RULE = { windowSec: 3600, max: 20 };

/**
 * POST /api/auth/password-reset — 邮箱验证码找回密码（无需登录态）。
 *
 * 流程：
 *   1. 校验入参（email + code + newPassword）
 *   2. IP 限流
 *   3. 邮箱必须已注册（不存在 → NOT_FOUND 阻断）
 *   4. 消费 RESET_PASSWORD 验证码（不匹配/过期/超限 → 对应错误码阻断）
 *   5. 更新密码哈希，清除 mustChangePassword
 *
 * 安全设计：
 *   - 验证码错误不会泄露邮箱是否存在（send 阶段已做存在性校验阻断）
 *   - mustChangePassword 一并清除，避免改密后仍被强制跳转
 *   - 不返回敏感信息，仅 { reset: true }
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);

  let body: unknown;
  try {
    body = await readJsonBody(req, { limitBytes: 16 * 1024 });
  } catch (err) {
    return failFromError(err, requestId);
  }

  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION_ERROR, {
      message: parsed.error.issues[0]?.message ?? "参数错误",
      details: parsed.error.issues,
      requestId,
    });
  }
  const { email, code, newPassword } = parsed.data;

  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) {
    return fail(ErrorCode.PASSWORD_INVALID, { message: policyError, requestId });
  }

  const decision = checkRateLimits([
    { key: `reset:ip:1h:${ip}`, rule: RESET_RULE },
  ]);
  if (!decision.allowed) {
    return fail(ErrorCode.RATE_LIMITED, {
      message: `操作过于频繁，请 ${decision.retryAfterSec}s 后重试`,
      requestId,
      headers: { "Retry-After": String(decision.retryAfterSec) },
    });
  }

  // 邮箱必须已注册
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true },
  });
  if (!user) {
    return fail(ErrorCode.NOT_FOUND, {
      message: "该邮箱未注册，请先注册账号",
      requestId,
    });
  }

  // 校验并消费验证码（验证码错误/过期/超限由 service 抛出对应错误码）
  try {
    await consumeEmailCode({ email, purpose: "RESET_PASSWORD", code });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }

  // 改密 + 清除强制改密标记
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  log.info({ userId: user.id, email }, "密码已通过验证码重置");
  return ok({ reset: true }, { requestId });
}
