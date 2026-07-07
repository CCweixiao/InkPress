import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { registerSchema } from "@/lib/validation/schemas";
import { consumeEmailCode } from "@/lib/email-code-service";
import { hashPassword, validatePasswordPolicy } from "@/lib/security/password";
import { ensureUserInvitationCode } from "@/lib/invite-code";
import { checkRateLimits } from "@/lib/rate-limit";
import { getClientIp, readJsonBody } from "@/lib/http";
import { moduleLogger } from "@/lib/logger";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

const log = moduleLogger("register");

// 注册限流：每 IP 每小时 20 次（PDC §9.3）
const REGISTER_RULE = { windowSec: 3600, max: 20 };

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);

  let body: unknown;
  try {
    body = await readJsonBody(req, { limitBytes: 16 * 1024 });
  } catch (err) {
    return failFromError(err, requestId);
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION_ERROR, {
      message: parsed.error.issues[0]?.message ?? "参数错误",
      details: parsed.error.issues,
      requestId,
    });
  }
  const { email, password, code } = parsed.data;

  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    return fail(ErrorCode.PASSWORD_INVALID, { message: policyError, requestId });
  }

  const decision = checkRateLimits([
    { key: `register:ip:1h:${ip}`, rule: REGISTER_RULE },
  ]);
  if (!decision.allowed) {
    return fail(ErrorCode.RATE_LIMITED, {
      message: `注册过于频繁，请 ${decision.retryAfterSec}s 后重试`,
      requestId,
      headers: { "Retry-After": String(decision.retryAfterSec) },
    });
  }

  // 邮箱已注册
  const existed = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existed) {
    return fail(ErrorCode.EMAIL_ALREADY_REGISTERED, {
      message: "该邮箱已注册",
      requestId,
    });
  }

  // 校验并消费验证码（错误码由 service 抛出）
  try {
    await consumeEmailCode({ email, purpose: "REGISTER", code });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }

  // 建用户 + 补发邀请码（从简设计：不采集昵称，name 留空，用户可在设置页自行维护）
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: null,
      role: "USER",
      status: "ACTIVE",
      emailVerified: new Date(),
    },
  });
  const invitationCode = await ensureUserInvitationCode(user.id);

  log.info({ userId: user.id, email }, "用户注册成功");
  return ok(
    { registered: true, email: user.email, invitationCode },
    { status: 201, requestId }
  );
}
