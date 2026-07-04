import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { getOrderAdmin } from "@/lib/payment/order-service";
import { ok, failFromError, getRequestId } from "@/lib/api-response";

/** GET /api/admin/orders/:id — 管理员订单详情 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const { id } = await params;
    const order = await getOrderAdmin(id);
    return ok(order, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
