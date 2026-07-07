import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { ok, fail, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/**
 * GET /api/me/licenses — 当前用户邀请码归因的 License 概况（PDC §7.1）。
 * 仅返回绑定到自己 userId 的 License，不含 keyHash。
 */
export async function GET(req: Request) {
  const requestId = getRequestId(new Headers(req.headers));
  const session = await auth();
  if (!session?.user?.id) {
    return fail(ErrorCode.UNAUTHORIZED, { message: "请先登录", requestId });
  }

  const items = await prisma.licenseKey.findMany({
    where: { inviterUserId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      keyFingerprint: true,
      displayKeySuffix: true,
      durationKind: true,
      status: true,
      maxDevices: true,
      firstActivatedAt: true,
      effectiveExpiresAt: true,
      createdAt: true,
      _count: { select: { activations: { where: { status: "ACTIVE" } } } },
    },
  });

  return ok(
    {
      items: items.map((it) => ({
        id: it.id,
        keyFingerprint: it.keyFingerprint,
        displayKeySuffix: it.displayKeySuffix,
        durationKind: it.durationKind,
        status: it.status,
        maxDevices: it.maxDevices,
        activeDevices: it._count.activations,
        firstActivatedAt: it.firstActivatedAt,
        effectiveExpiresAt: it.effectiveExpiresAt,
        createdAt: it.createdAt,
      })),
    },
    { requestId }
  );
}
