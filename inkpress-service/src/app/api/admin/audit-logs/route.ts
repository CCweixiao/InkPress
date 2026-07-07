import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { listAuditLogs } from "@/lib/admin/audit-service";
import { paginationSchema } from "@/lib/validation/schemas";
import { ok, failFromError, getRequestId } from "@/lib/api-response";

/** GET /api/admin/audit-logs — 管理操作审计日志 */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const params = req.nextUrl.searchParams;
    const { page, pageSize } = paginationSchema.parse({
      page: params.get("page") ?? 1,
      pageSize: params.get("pageSize") ?? 10,
    });
    const result = await listAuditLogs({
      page,
      pageSize,
      action: params.get("action") ?? undefined,
      targetType: params.get("targetType") ?? undefined,
      actorUserId: params.get("actorUserId") ?? undefined,
    });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
