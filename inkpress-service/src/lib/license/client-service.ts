import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  hashKey,
  computeEffectiveExpiresAt,
} from "@/lib/license/key";
import {
  generateActivationSecret,
  decryptActivationSecret,
} from "@/lib/license/activation-secret";
import { signLicenseToken } from "@/lib/license/token";
import { writeValidationLog } from "@/lib/license/validation-log";
import type { VerifiedActivation } from "@/lib/license/request-guard";
import type {
  ActivateLicenseInput,
  ValidateLicenseInput,
  DeactivateLicenseInput,
} from "@/lib/validation/schemas";

/**
 * License 客户端业务层（activate / validate / deactivate，PDC §4-5、§7）。
 *
 * 通用约定：
 * - 服务端只用 `hashKey` 精确匹配 License，明文不入库/日志。
 * - 同 key + 同设备重复激活幂等（返回原 activationId）。
 * - 设备数以 ACTIVE 激活计数；非 ACTIVE 不计数。
 * - 失败路径写 DENIED/ERROR 日志后抛 AppError；成功写 ALLOWED。
 */

type LogCtx = {
  action: "ACTIVATE" | "VALIDATE" | "DEACTIVATE";
  ip: string | null;
  ua: string | null;
  appVersion?: string | null;
  deviceIdHash?: string | null;
};

/** 用日志包裹业务：scope 显式给出 logResult（默认 ALLOWED）；AppError → DENIED，其余 → ERROR。 */
async function withLog<T>(
  ctx: LogCtx,
  scope: () => Promise<{
    result: T;
    log: {
      licenseKeyId?: string | null;
      activationId?: string | null;
      /** 业务态：ACTIVE/解绑成功为 ALLOWED；validate 的非 ACTIVE 态为 DENIED */
      logResult?: "ALLOWED" | "DENIED";
    };
  }>
): Promise<T> {
  let licenseKeyId: string | null = null;
  let activationId: string | null = null;
  try {
    const { result, log } = await scope();
    licenseKeyId = log.licenseKeyId ?? null;
    activationId = log.activationId ?? null;
    await writeValidationLog({
      ...ctx,
      licenseKeyId,
      activationId,
      result: log.logResult ?? "ALLOWED",
    });
    return result;
  } catch (err) {
    await writeValidationLog({
      ...ctx,
      licenseKeyId,
      activationId,
      result: err instanceof AppError ? "DENIED" : "ERROR",
      reason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function secretFingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export interface ActivateResult {
  activationId: string;
  status: "ACTIVE";
  effectiveExpiresAt: string | null;
  maxDevices: number;
  activatedDevices: number;
  licenseToken: string;
  activationSecret: string;
  nextCheckAt: string;
  inviterCode?: string;
}

/** 激活当前设备：哈希匹配 → 状态/过期校验 → 幂等 upsert（含设备数限制）→ 签 token。 */
export async function activateLicense(opts: {
  input: ActivateLicenseInput;
  ip: string | null;
  ua: string | null;
}): Promise<ActivateResult> {
  const { input, ip, ua } = opts;
  const now = new Date();
  const deviceIdHash = input.device.deviceIdHash;

  return withLog<ActivateResult>(
    { action: "ACTIVATE", ip, ua, appVersion: input.app.version, deviceIdHash },
    async () => {
      const license = await prisma.licenseKey.findUnique({
        where: { keyHash: hashKey(input.licenseKey) },
        select: {
          id: true,
          status: true,
          durationKind: true,
          durationYears: true,
          durationDays: true,
          effectiveExpiresAt: true,
          maxDevices: true,
          firstActivatedAt: true,
          inviterCode: true,
        },
      });
      if (!license) {
        throw new AppError(ErrorCode.LICENSE_INVALID, "License Key 无效");
      }
      if (license.status === "REVOKED") {
        throw new AppError(ErrorCode.LICENSE_REVOKED, "License 已被撤销");
      }
      if (license.status === "DISABLED") {
        throw new AppError(ErrorCode.LICENSE_DISABLED, "License 已被禁用");
      }
      if (license.effectiveExpiresAt && license.effectiveExpiresAt <= now) {
        throw new AppError(ErrorCode.LICENSE_EXPIRED, "License 已过期");
      }

      const txResult = await prisma.$transaction(async (tx) => {
        const existing = await tx.licenseActivation.findUnique({
          where: {
            licenseKeyId_deviceIdHash: { licenseKeyId: license.id, deviceIdHash },
          },
        });

        if (existing) {
          // 幂等重激活：DEACTIVATED/REVOKED 复活需重新占设备位
          if (existing.status !== "ACTIVE") {
            const active = await tx.licenseActivation.count({
              where: { licenseKeyId: license.id, status: "ACTIVE" },
            });
            if (active >= license.maxDevices) {
              throw new AppError(
                ErrorCode.DEVICE_LIMIT_EXCEEDED,
                "已达最大设备数"
              );
            }
          }
          // 复用既有 secret（解密还原）；若历史无密文则重新生成
          let plaintext: string;
          let enc: string;
          if (existing.activationSecretEnc) {
            plaintext = decryptActivationSecret(existing.activationSecretEnc);
            enc = existing.activationSecretEnc;
          } else {
            const g = generateActivationSecret();
            plaintext = g.plaintext;
            enc = g.enc;
          }
          await tx.licenseActivation.update({
            where: { id: existing.id },
            data: {
              status: "ACTIVE",
              deactivatedAt: null,
              revokedAt: null,
              revokedReason: null,
              machineIdHash: input.device.machineIdHash ?? null,
              macHash: input.device.macHash ?? null,
              hostnameHash: input.device.hostnameHash ?? null,
              os: input.device.os,
              arch: input.device.arch,
              appVersion: input.app.version,
              lastValidatedAt: now,
              ipLast: ip,
              userAgentLast: ua,
              activationSecretEnc: enc,
              activationSecretHash: secretFingerprint(plaintext),
            },
          });
          return {
            activationId: existing.id,
            secret: plaintext,
            effectiveExpiresAt: license.effectiveExpiresAt,
          };
        }

        // 新设备：先查设备数
        const active = await tx.licenseActivation.count({
          where: { licenseKeyId: license.id, status: "ACTIVE" },
        });
        if (active >= license.maxDevices) {
          throw new AppError(
            ErrorCode.DEVICE_LIMIT_EXCEEDED,
            "已达最大设备数"
          );
        }

        // 首次激活：计算所有设备共用的过期点
        let effectiveExpiresAt = license.effectiveExpiresAt;
        const isFirst = !license.firstActivatedAt;
        if (isFirst) {
          effectiveExpiresAt = computeEffectiveExpiresAt(
            license.durationKind,
            license.durationYears,
            license.durationDays,
            now
          );
        }

        const g = generateActivationSecret();
        const created = await tx.licenseActivation.create({
          data: {
            licenseKeyId: license.id,
            deviceIdHash,
            machineIdHash: input.device.machineIdHash ?? null,
            macHash: input.device.macHash ?? null,
            hostnameHash: input.device.hostnameHash ?? null,
            os: input.device.os,
            arch: input.device.arch,
            appVersion: input.app.version,
            status: "ACTIVE",
            activationSecretEnc: g.enc,
            activationSecretHash: g.fingerprint,
            ipFirst: ip,
            ipLast: ip,
            userAgentLast: ua,
            lastValidatedAt: now,
          },
        });

        if (isFirst) {
          await tx.licenseKey.update({
            where: { id: license.id },
            data: { firstActivatedAt: now, effectiveExpiresAt },
          });
        }

        return {
          activationId: created.id,
          secret: g.plaintext,
          effectiveExpiresAt,
        };
      });

      const activatedDevices = await prisma.licenseActivation.count({
        where: { licenseKeyId: license.id, status: "ACTIVE" },
      });

      const licenseToken = signLicenseToken({
        activationId: txResult.activationId,
        licenseId: license.id,
        deviceId: deviceIdHash,
        effectiveExpiresAt: txResult.effectiveExpiresAt,
        maxDevices: license.maxDevices,
      });
      // nextCheckAt 取自 token payload 的 issuedAt+1h；这里与 token 对齐给出 ISO
      const nextCheckAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

      const result: ActivateResult = {
        activationId: txResult.activationId,
        status: "ACTIVE",
        effectiveExpiresAt: txResult.effectiveExpiresAt
          ? txResult.effectiveExpiresAt.toISOString()
          : null,
        maxDevices: license.maxDevices,
        activatedDevices,
        licenseToken,
        activationSecret: txResult.secret,
        nextCheckAt,
      };
      if (license.inviterCode) result.inviterCode = license.inviterCode;
      return { result, log: { licenseKeyId: license.id, activationId: txResult.activationId } };
    }
  );
}

type ValidateStatus =
  | "ACTIVE"
  | "EXPIRED"
  | "DISABLED"
  | "REVOKED"
  | "DEVICE_MISMATCH";

export interface ValidateResult {
  status: ValidateStatus;
  effectiveExpiresAt: string | null;
  licenseToken?: string;
  nextCheckAt?: string;
  offlineGraceSeconds?: number;
  message?: string;
}

const OFFLINE_GRACE_SECONDS = 72 * 60 * 60;

/** 校验激活状态：业务态以 200+status 返回（不抛），仅 ACTIVE 刷新并重签 token。 */
export async function validateLicense(opts: {
  input: ValidateLicenseInput;
  activation: VerifiedActivation;
  ip: string | null;
  ua: string | null;
}): Promise<ValidateResult> {
  const { input, activation, ip, ua } = opts;
  const now = new Date();
  const license = activation.licenseKey;

  return withLog<ValidateResult>(
    { action: "VALIDATE", ip, ua, appVersion: input.appVersion, deviceIdHash: input.deviceIdHash },
    async () => {
      // 归属校验：签名 body 中的设备必须与激活绑定一致
      if (activation.deviceIdHash !== input.deviceIdHash) {
        const res: ValidateResult = {
          status: "DEVICE_MISMATCH",
          effectiveExpiresAt: license.effectiveExpiresAt
            ? license.effectiveExpiresAt.toISOString()
            : null,
          message: "设备不匹配",
        };
        return {
          result: res,
          log: { licenseKeyId: license.id, activationId: activation.id, logResult: "DENIED" },
        };
      }
      if (activation.status !== "ACTIVE") {
        const res: ValidateResult = {
          status: "DEVICE_MISMATCH",
          effectiveExpiresAt: license.effectiveExpiresAt
            ? license.effectiveExpiresAt.toISOString()
            : null,
          message: "激活已失效",
        };
        return {
          result: res,
          log: { licenseKeyId: license.id, activationId: activation.id, logResult: "DENIED" },
        };
      }
      if (license.status === "REVOKED") {
        const res: ValidateResult = {
          status: "REVOKED",
          effectiveExpiresAt: license.effectiveExpiresAt
            ? license.effectiveExpiresAt.toISOString()
            : null,
          message: "License 已被撤销",
        };
        return {
          result: res,
          log: { licenseKeyId: license.id, activationId: activation.id, logResult: "DENIED" },
        };
      }
      if (license.status === "DISABLED") {
        const res: ValidateResult = {
          status: "DISABLED",
          effectiveExpiresAt: license.effectiveExpiresAt
            ? license.effectiveExpiresAt.toISOString()
            : null,
          message: "License 已被禁用",
        };
        return {
          result: res,
          log: { licenseKeyId: license.id, activationId: activation.id, logResult: "DENIED" },
        };
      }
      if (license.effectiveExpiresAt && license.effectiveExpiresAt <= now) {
        const res: ValidateResult = {
          status: "EXPIRED",
          effectiveExpiresAt: license.effectiveExpiresAt.toISOString(),
          message: "License 已过期",
        };
        return {
          result: res,
          log: { licenseKeyId: license.id, activationId: activation.id, logResult: "DENIED" },
        };
      }

      // ACTIVE：刷新校验时间并重签 token
      await prisma.licenseActivation.update({
        where: { id: activation.id },
        data: {
          lastValidatedAt: now,
          ipLast: ip,
          userAgentLast: ua,
          appVersion: input.appVersion,
        },
      });
      const licenseToken = signLicenseToken({
        activationId: activation.id,
        licenseId: license.id,
        deviceId: activation.deviceIdHash,
        effectiveExpiresAt: license.effectiveExpiresAt,
        maxDevices: license.maxDevices,
      });
      const res: ValidateResult = {
        status: "ACTIVE",
        effectiveExpiresAt: license.effectiveExpiresAt
          ? license.effectiveExpiresAt.toISOString()
          : null,
        licenseToken,
        nextCheckAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        offlineGraceSeconds: OFFLINE_GRACE_SECONDS,
      };
      return { result: res, log: { licenseKeyId: license.id, activationId: activation.id } };
    }
  );
}

export interface DeactivateResult {
  activationId: string;
  status: "DEACTIVATED";
}

/** 解绑本设备：归属校验 → 置 DEACTIVATED（已非 ACTIVE 则幂等返回）。 */
export async function deactivateLicense(opts: {
  input: DeactivateLicenseInput;
  activation: VerifiedActivation;
  ip: string | null;
  ua: string | null;
}): Promise<DeactivateResult> {
  const { input, activation, ip, ua } = opts;
  const now = new Date();

  return withLog<DeactivateResult>(
    { action: "DEACTIVATE", ip, ua, deviceIdHash: input.deviceIdHash },
    async () => {
      if (activation.deviceIdHash !== input.deviceIdHash) {
        throw new AppError(ErrorCode.DEVICE_MISMATCH, "设备不匹配");
      }
      if (activation.status !== "ACTIVE") {
        return {
          result: { activationId: activation.id, status: "DEACTIVATED" },
          log: { licenseKeyId: activation.licenseKeyId, activationId: activation.id },
        };
      }
      await prisma.licenseActivation.update({
        where: { id: activation.id },
        data: { status: "DEACTIVATED", deactivatedAt: now, ipLast: ip, userAgentLast: ua },
      });
      return {
        result: { activationId: activation.id, status: "DEACTIVATED" },
        log: { licenseKeyId: activation.licenseKeyId, activationId: activation.id },
      };
    }
  );
}
