import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { listMyOrders } from "@/lib/payment/order-service";
import { paginationSchema } from "@/lib/validation/schemas";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/** GET /api/me/orders — 当前登录用户的订单历史 */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return fail(ErrorCode.UNAUTHORIZED, { message: "请先登录", requestId });
    }
    const params = req.nextUrl.searchParams;
    const { page, pageSize } = paginationSchema.parse({
      page: params.get("page") ?? 1,
      pageSize: params.get("pageSize") ?? 20,
    });
    const result = await listMyOrders(session.user.id, { page, pageSize });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
