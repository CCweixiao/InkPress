import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { listAllReleases } from "@/lib/release/service";
import { ok, failFromError, getRequestId } from "@/lib/api-response";

/**
 * GET /api/admin/releases — 全部版本（含 HIDDEN），管理端用。
 *
 * Query:
 *   - package=<packageName>：按包名过滤
 *   - status=PUBLISHED | HIDDEN：按状态过滤
 *   - page / pageSize（默认 1 / 50）
 */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? 50)));

    const result = await listAllReleases({
      packageName: sp.get("package") ?? undefined,
      status: sp.get("status") ?? undefined,
      page,
      pageSize,
    });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
