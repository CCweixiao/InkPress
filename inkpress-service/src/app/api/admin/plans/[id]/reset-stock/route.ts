import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { resetDailyStock } from "@/lib/plan/plan-service";
import { getClientIp, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * POST /api/admin/plans/:id/reset-stock — 手动重置今日库存。
 *
 * 实现方式：把 dailyStockResetAt 设为 now，计数器从此刻起从 0 累加。
 * 配合前端「重置库存」按钮。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const updated = await resetDailyStock(id, {
      id: session.user.id,
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok(updated, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
