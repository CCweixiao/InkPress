import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { listUsers } from "@/lib/admin/user-service";
import { paginationSchema } from "@/lib/validation/schemas";
import { ok, failFromError, getRequestId } from "@/lib/api-response";

/** GET /api/admin/users — 用户列表（email/status/role 查询） */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const params = req.nextUrl.searchParams;
    const { page, pageSize } = paginationSchema.parse({
      page: params.get("page") ?? 1,
      pageSize: params.get("pageSize") ?? 20,
    });
    const result = await listUsers({
      page,
      pageSize,
      search: params.get("search") ?? undefined,
      status: params.get("status") ?? undefined,
      role: params.get("role") ?? undefined,
    });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
