import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { ok, fail, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";
import {
  computeLicenseLifecycle,
  durationLabel,
} from "@/lib/license/key";

/**
 * GET /api/me/owned-licenses — 当前登录用户邮箱名下绑定的 License 清单。
 *
 * 数据来源：LicenseKey.ownerEmail === session.user.email（创建时由管理员绑定）。
 * 与 /api/me/licenses（按 inviterUserId 归因）正交：归因代表「我邀请产生」，
 * 归属代表「我能使用」，两者语义不同，故拆成独立端点。
 *
 * 出于隐私考虑，激活记录不返回 IP/UserAgent；只返回设备展示所需的指纹哈希前缀、
 * 运行环境、版本与时间戳。
 */
export async function GET(req: Request) {
  const requestId = getRequestId(new Headers(req.headers));
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return fail(ErrorCode.UNAUTHORIZED, { message: "请先登录", requestId });
  }

  // User.email 在注册时已 trim+lower，ownerEmail 在创建时也走了同样规范化，
  // 这里再保险做一次，避免大小写差异造成漏查。
  const ownerEmail = session.user.email.trim().toLowerCase();

  const rows = await prisma.licenseKey.findMany({
    where: { ownerEmail },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      keyFingerprint: true,
      displayKeySuffix: true,
      durationKind: true,
      durationYears: true,
      durationDays: true,
      effectiveExpiresAt: true,
      maxDevices: true,
      status: true,
      firstActivatedAt: true,
      disabledAt: true,
      revokedAt: true,
      createdAt: true,
      note: true,
      activations: {
        orderBy: { activatedAt: "desc" },
        select: {
          id: true,
          deviceIdHash: true,
          os: true,
          arch: true,
          appVersion: true,
          status: true,
          activatedAt: true,
          lastValidatedAt: true,
          deactivatedAt: true,
        },
      },
    },
  });

  const now = new Date();
  const items = rows.map((r) => ({
    id: r.id,
    keyFingerprint: r.keyFingerprint,
    displayKeySuffix: r.displayKeySuffix,
    durationKind: r.durationKind,
    durationLabel: durationLabel(
      r.durationKind,
      r.durationYears,
      r.durationDays
    ),
    maxDevices: r.maxDevices,
    activeDevices: r.activations.filter((a) => a.status === "ACTIVE").length,
    status: r.status,
    lifecycle: computeLicenseLifecycle(
      r.firstActivatedAt,
      r.effectiveExpiresAt,
      now
    ),
    firstActivatedAt: r.firstActivatedAt,
    effectiveExpiresAt: r.effectiveExpiresAt,
    createdAt: r.createdAt,
    note: r.note,
    activations: r.activations.map((a) => ({
      id: a.id,
      deviceIdShort: a.deviceIdHash.slice(0, 12),
      os: a.os,
      arch: a.arch,
      appVersion: a.appVersion,
      status: a.status,
      activatedAt: a.activatedAt,
      lastValidatedAt: a.lastValidatedAt,
      deactivatedAt: a.deactivatedAt,
    })),
  }));

  return ok({ items }, { requestId });
}
