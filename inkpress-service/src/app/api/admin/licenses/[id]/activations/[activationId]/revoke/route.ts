import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { revokeActivation } from "@/lib/license/admin-service";
import { getClientIp, truncateUa } from "@/lib/http";
import { ok, failFromError, getRequestId } from "@/lib/api-response";

/**
 * POST /api/admin/licenses/:id/activations/:activationId/revoke
 * 管理员解绑/撤销某台设备（PDC §7.2）。Phase 3 客户端激活后产生数据。
 */
export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; activationId: string }>;
  }
) {
  const requestId = getRequestId(req.headers);
  try {
    const session = await requireAdmin();
    const { id, activationId } = await params;
    let reason: string | undefined;
    try {
      const body = await req.json();
      reason =
        typeof body?.reason === "string" ? body.reason.slice(0, 200) : undefined;
    } catch {
      /* 允许空 body */
    }
    const result = await revokeActivation(id, activationId, reason, {
      id: session.user.id,
      ip: getClientIp(req.headers),
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

