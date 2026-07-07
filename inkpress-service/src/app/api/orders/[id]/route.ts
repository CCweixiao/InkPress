import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getOrderForUser } from "@/lib/payment/order-service";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/**
 * GET /api/orders/:id — 前端轮询订单状态（收银台 2s 间隔）。
 * 归属校验在 service 层：order.userId !== session.user.id 一律 404。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return fail(ErrorCode.UNAUTHORIZED, { message: "请先登录", requestId });
    }
    const { id } = await params;
    const order = await getOrderForUser(id, session.user.id);
    return ok(order, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
