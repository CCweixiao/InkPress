import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import {
  getLicenseDetail,
  updateLicense,
  deleteLicense,
} from "@/lib/license/admin-service";
import { updateLicenseSchema } from "@/lib/validation/schemas";
import { getClientIp, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

/** GET /api/admin/licenses/:id — 详情（设备、最近校验日志、归因） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const { id } = await params;
    const detail = await getLicenseDetail(id);
    return ok(detail, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

/** PATCH /api/admin/licenses/:id — 禁用/启用/撤销/改备注 */
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
    const parsed = updateLicenseSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }
    const detail = await updateLicense(
      id,
      { status: parsed.data.status, note: parsed.data.note, extendDays: parsed.data.extendDays },
      {
        id: session.user.id,
        ip: getClientIp(req.headers),
        ua: truncateUa(req.headers.get("user-agent")),
      }
    );
    return ok(detail, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}

/** DELETE /api/admin/licenses/:id — 硬删除（仅待激活/已过期） */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const result = await deleteLicense(id, {
      id: session.user.id,
      ip: getClientIp(req.headers),
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok(result, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
