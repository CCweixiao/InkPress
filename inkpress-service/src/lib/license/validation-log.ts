import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import { truncateUa } from "@/lib/http";

const log = moduleLogger("license:validation-log");

export interface ValidationLogInput {
  licenseKeyId?: string | null;
  activationId?: string | null;
  deviceIdHash?: string | null;
  action: "ACTIVATE" | "VALIDATE" | "DEACTIVATE";
  result: "ALLOWED" | "DENIED" | "RATE_LIMITED" | "ERROR";
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  appVersion?: string | null;
}

/**
 * 写 License 校验日志（PDC §9.4）。可异步、失败仅记录不抛，但错误必须可见。
 */
export async function writeValidationLog(
  input: ValidationLogInput
): Promise<void> {
  try {
    await prisma.licenseValidationLog.create({
      data: {
        licenseKeyId: input.licenseKeyId ?? null,
        activationId: input.activationId ?? null,
        deviceIdHash: input.deviceIdHash ?? null,
        action: input.action,
        result: input.result,
        reason: input.reason ?? null,
        ip: input.ip ?? null,
        userAgent: truncateUa(input.userAgent ?? null),
        appVersion: input.appVersion ?? null,
      },
    });
  } catch (err) {
    log.error({ err, action: input.action, result: input.result }, "校验日志写入失败");
  }
}
