import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import { sendMail, renderRegisterCodeEmail } from "@/lib/email";
import { generateNumericCode, sha256Hex, safeEqual } from "@/lib/security/random";
import { AppError, ErrorCode } from "@/lib/errors";
import type { EmailCodePurpose } from "@/lib/validation/schemas";

const log = moduleLogger("email-code");

const CODE_TTL_MS = 10 * 60 * 1000; // 10 分钟有效
const MAX_ATTEMPTS = 5;

export interface SendCodeInput {
  email: string;
  purpose: EmailCodePurpose;
  ip: string | null;
  ua: string | null;
}

/**
 * 生成验证码：使该 email+purpose 下先前未用记录失效（superseded），
 * 写入新记录（仅 codeHash，明文不入库），再经邮件适配器发出。
 */
export async function issueEmailCode(input: SendCodeInput): Promise<void> {
  const { email, purpose, ip, ua } = input;
  const code = generateNumericCode(6);
  const codeHash = sha256Hex(code);
  const now = new Date();

  await prisma.emailVerificationCode.updateMany({
    where: { email, purpose, usedAt: null },
    data: { usedAt: now },
  });
  await prisma.emailVerificationCode.create({
    data: {
      email,
      purpose,
      codeHash,
      maxAttempts: MAX_ATTEMPTS,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      createdIp: ip,
      createdUa: ua,
    },
  });

  // Phase 1 仅 REGISTER 有模板；其他用途预留
  if (purpose !== "REGISTER") {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "暂不支持的验证码用途");
  }
  await sendMail(renderRegisterCodeEmail(email, code, CODE_TTL_MS / 60_000));
  log.info({ email, purpose }, "验证码已发送");
}

export interface ConsumeCodeInput {
  email: string;
  purpose: EmailCodePurpose;
  code: string;
}

/**
 * 校验并消费验证码：匹配最新有效记录 → 校验哈希 → 标记 usedAt。
 * 错误码：过期 EMAIL_CODE_EXPIRED、错误 EMAIL_CODE_INVALID、超限 EMAIL_CODE_TOO_MANY_ATTEMPTS。
 */
export async function consumeEmailCode(input: ConsumeCodeInput): Promise<void> {
  const { email, purpose, code } = input;
  const now = new Date();

  const record = await prisma.emailVerificationCode.findFirst({
    where: { email, purpose, usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });

  if (!record) {
    throw new AppError(ErrorCode.EMAIL_CODE_EXPIRED, "验证码已过期或不存在，请重新获取");
  }
  if (record.attempts >= record.maxAttempts) {
    throw new AppError(
      ErrorCode.EMAIL_CODE_TOO_MANY_ATTEMPTS,
      "验证码错误次数过多，请重新获取"
    );
  }

  if (!safeEqual(sha256Hex(code), record.codeHash)) {
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError(ErrorCode.EMAIL_CODE_INVALID, "验证码错误");
  }

  await prisma.emailVerificationCode.update({
    where: { id: record.id },
    data: { usedAt: now },
  });
}
