import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { patchUser } from "@/lib/admin/user-service";
import { patchUserSchema } from "@/lib/validation/schemas";
import { getClientIp, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/** PATCH /api/admin/users/:id — 禁用/启用/改角色 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  try {
    const session = await requireAdmin();
    const { id } = await params;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail(ErrorCode.VALIDATION_ERROR, { message: "请求体非法", requestId });
    }
    const parsed = patchUserSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }
    const user = await patchUser(
      id,
      { status: parsed.data.status, role: parsed.data.role },
      {
        id: session.user.id,
        ip: getClientIp(req.headers),
        ua: truncateUa(req.headers.get("user-agent")),
      }
    );
    return ok(user, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
