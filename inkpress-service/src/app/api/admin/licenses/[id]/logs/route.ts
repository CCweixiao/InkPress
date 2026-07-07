import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { listValidationLogs } from "@/lib/license/validation-log";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/** GET /api/admin/licenses/:id/logs?page=1&pageSize=20&days=3 — 分页校验日志 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const { id } = await params;
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
    const days = Number(url.searchParams.get("days") ?? "3");

    if (!Number.isFinite(page) || page < 1) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "page 必须 >= 1",
        requestId,
      });
    }
    if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "pageSize 必须在 1-100 之间",
        requestId,
      });
    }

    const result = await listValidationLogs({
      licenseKeyId: id,
      page,
      pageSize,
      days: Number.isFinite(days) ? days : 3,
    });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
