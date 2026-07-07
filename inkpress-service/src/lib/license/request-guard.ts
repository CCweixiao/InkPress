import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, ErrorCode } from "@/lib/errors";
import { signedHeadersSchema } from "@/lib/validation/schemas";
import { decryptActivationSecret } from "@/lib/license/activation-secret";
import {
  bodyHashOf,
  verifyRequestSignature,
} from "@/lib/license/request-signature";
import { checkAndStoreNonce } from "@/lib/license/replay-store";
import type { Prisma } from "@/generated/prisma/client";

const TIMESTAMP_SKEW_SEC = 5 * 60; // PDC §5.3：时间偏差不超过 5 分钟

const minimalBodySchema = z.object({
  activationId: z.string().trim().min(1).max(64),
});

/** 验签通过后返回的激活记录（含关联 License）。 */
export type VerifiedActivation = Prisma.LicenseActivationGetPayload<{
  include: {
    licenseKey: {
      select: {
        id: true;
        status: true;
        durationKind: true;
        effectiveExpiresAt: true;
        maxDevices: true;
        disabledAt: true;
        revokedAt: true;
      };
    };
  };
}>;

export interface VerifiedRequest {
  activation: VerifiedActivation;
  headers: z.infer<typeof signedHeadersSchema>;
}

/**
 * 校验带签名请求（validate / deactivate 共用，PDC §5.3）。
 *
 * 顺序（防 nonce 污染、防信息泄露）：
 *   1. 解析签名头 + 时间偏差
 *   2. 解 body 取 activationId → 查 activation（含 licenseKey）
 *   3. 解密 activationSecret → HMAC 验签
 *   4. 验签通过后才登记 nonce（REPLAY_DETECTED）
 *
 * 任一步失败抛 AppError(SIGNATURE_INVALID / REPLAY_DETECTED / VALIDATION_ERROR)，
 * 对外统一模糊化，真实原因由调用方写日志。
 */
export async function loadActivationAndVerify(
  req: NextRequest,
  rawBody: string
): Promise<VerifiedRequest> {
  const h = req.headers;
  const parsedHeaders = signedHeadersSchema.safeParse({
    clientId: h.get("x-inkpress-client-id"),
    deviceId: h.get("x-inkpress-device-id"),
    timestamp: h.get("x-inkpress-timestamp"),
    nonce: h.get("x-inkpress-nonce"),
    signature: h.get("x-inkpress-signature"),
  });
  if (!parsedHeaders.success) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "签名头缺失或格式错误");
  }
  const hd = parsedHeaders.data;

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - hd.timestamp) > TIMESTAMP_SKEW_SEC) {
    throw new AppError(ErrorCode.SIGNATURE_INVALID, "请求时间偏差过大");
  }

  let activationId: string;
  try {
    const parsed = minimalBodySchema.parse(JSON.parse(rawBody));
    activationId = parsed.activationId;
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "请求体非法");
  }

  const activation = await prisma.licenseActivation.findUnique({
    where: { id: activationId },
    include: {
      licenseKey: {
        select: {
          id: true,
          status: true,
          durationKind: true,
          effectiveExpiresAt: true,
          maxDevices: true,
          disabledAt: true,
          revokedAt: true,
        },
      },
    },
  });
  if (!activation || !activation.activationSecretEnc) {
    throw new AppError(ErrorCode.SIGNATURE_INVALID, "签名校验失败");
  }

  let secret: string;
  try {
    secret = decryptActivationSecret(activation.activationSecretEnc);
  } catch {
    throw new AppError(ErrorCode.SIGNATURE_INVALID, "签名校验失败");
  }

  const path = req.nextUrl.pathname;
  const bodyHash = bodyHashOf(rawBody);
  const ok = verifyRequestSignature(
    secret,
    hd.signature,
    req.method,
    path,
    String(hd.timestamp),
    hd.nonce,
    bodyHash
  );
  if (!ok) {
    throw new AppError(ErrorCode.SIGNATURE_INVALID, "签名校验失败");
  }

  const replay = checkAndStoreNonce(hd.nonce);
  if (replay.replayed) {
    throw new AppError(ErrorCode.REPLAY_DETECTED, "请求重放");
  }

  return { activation, headers: hd };
}
