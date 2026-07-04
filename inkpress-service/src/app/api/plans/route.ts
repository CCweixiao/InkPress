import { listPublicPlans } from "@/lib/plan/plan-service";
import { ok, failFromError, getRequestId } from "@/lib/api-response";

/**
 * GET /api/plans — 公开订阅计划列表（首页价格区使用）。
 *
 * 不需要登录；仅返回 status=ACTIVE 的计划，按 sortOrder 升序。
 */
export async function GET(req: Request) {
  const requestId = getRequestId(new Headers(req.headers));
  try {
    const items = await listPublicPlans();
    return ok({ items }, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
