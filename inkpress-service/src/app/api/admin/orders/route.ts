import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { listAllOrders } from "@/lib/payment/order-service";
import { paginationSchema, OrderStatusSchema } from "@/lib/validation/schemas";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/** GET /api/admin/orders — 管理员订单列表（带 user.email join） */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const params = req.nextUrl.searchParams;
    const { page, pageSize } = paginationSchema.parse({
      page: params.get("page") ?? 1,
      pageSize: params.get("pageSize") ?? 20,
    });
    const statusRaw = params.get("status") ?? undefined;
    if (statusRaw) {
      const parsed = OrderStatusSchema.safeParse(statusRaw);
      if (!parsed.success) {
        return fail(ErrorCode.VALIDATION_ERROR, {
          message: "status 参数错误",
          requestId,
        });
      }
    }
    const status = statusRaw ?? undefined;
    const search = params.get("search") ?? undefined;
    const result = await listAllOrders({ page, pageSize, status, search });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
