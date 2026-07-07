import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { updatePlan, deletePlan } from "@/lib/plan/plan-service";
import { updatePlanSchema } from "@/lib/validation/schemas";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

/** PATCH /api/admin/plans/:id — 更新订阅计划（部分字段） */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const { id } = await params;

    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 32 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = updatePlanSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }

    const updated = await updatePlan(id, parsed.data, {
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

/** DELETE /api/admin/plans/:id — 硬删除订阅计划 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const { id } = await params;
    await deletePlan(id, {
      id: session.user.id,
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok({ id, deletedAt: new Date() }, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
