import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { decryptLicenseKey } from "@/lib/license/key-vault";
import { writeAudit } from "@/lib/audit";
import { checkRateLimits, type RateLimitRule } from "@/lib/rate-limit";
import { getClientIp, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

const REVEAL_RULE = { windowSec: 300, max: 30 } as RateLimitRule;

/**
 * POST /api/me/owned-licenses/:id/reveal-key — 当前用户查看自己名下 License 的明文 Key。
 *
 * 与管理员 reveal-key 的差异：
 * - 不需要查看密码（用户已通过登录态认证身份）
 * - 仅能查看 ownerEmail === session.user.email 的 License
 * - 不存在 / 不归属当前用户 一律返回 404，避免枚举探测
 *
 * 审计：actorRole=USER，action=user.license.key.reveal，便于追溯用户自查行为。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) {
      return fail(ErrorCode.UNAUTHORIZED, { message: "请先登录", requestId });
    }

    const decision = checkRateLimits([
      {
        key: `user:reveal-key:user:5m:${session.user.id}`,
        rule: REVEAL_RULE,
      },
    ]);
    if (!decision.allowed) {
      return fail(ErrorCode.RATE_LIMITED, {
        message: `请求过于频繁，请 ${decision.retryAfterSec}s 后重试`,
        requestId,
        headers: { "Retry-After": String(decision.retryAfterSec) },
      });
    }

    const { id } = await params;
    const ownerEmail = session.user.email.trim().toLowerCase();

    // 仅取归属当前用户的记录；不匹配一律 404
    const license = await prisma.licenseKey.findUnique({
      where: { id },
      select: {
        id: true,
        ownerEmail: true,
        keyCiphertext: true,
        keyFingerprint: true,
        displayKeySuffix: true,
      },
    });

    if (!license || !license.ownerEmail || license.ownerEmail !== ownerEmail) {
      return fail(ErrorCode.NOT_FOUND, {
        message: "License 不存在或不归属当前用户",
        requestId,
      });
    }
    if (!license.keyCiphertext) {
      return fail(ErrorCode.NOT_FOUND, {
        message: "此 License 创建时未保存加密明文，无法查看",
        requestId,
      });
    }

    let plaintext: string;
    try {
      plaintext = decryptLicenseKey(license.keyCiphertext);
    } catch {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "License Key 解密失败");
    }

    await writeAudit({
      actorUserId: session.user.id,
      actorRole: "USER",
      action: "user.license.key.reveal",
      targetType: "LicenseKey",
      targetId: license.id,
      after: {
        keyFingerprint: license.keyFingerprint,
        displayKeySuffix: license.displayKeySuffix,
      },
      ip,
      userAgent: truncateUa(req.headers.get("user-agent")),
    });

    return ok(
      {
        id: license.id,
        licenseKey: plaintext,
        keyFingerprint: license.keyFingerprint,
        displayKeySuffix: license.displayKeySuffix,
      },
      { requestId }
    );
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
