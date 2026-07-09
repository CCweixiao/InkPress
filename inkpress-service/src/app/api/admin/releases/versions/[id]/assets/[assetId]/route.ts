import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { replaceAsset, deleteAsset } from "@/lib/release/service";
import { getClientIp, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * PATCH /api/admin/releases/versions/:id/assets/:assetId — 替换架构包文件。
 * multipart/form-data，字段 file: 二进制文件。保留 downloadCount。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const { id: versionId, assetId } = await params;

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "需要 file（文件）字段",
        requestId,
      });
    }
    if (file.size > MAX_ASSET_BYTES) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: `文件超过上限 2GB`,
        requestId,
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await replaceAsset(
      versionId,
      assetId,
      { fileName: file.name, buffer },
      { actorUserId: session.user.id, ip, ua: truncateUa(req.headers.get("user-agent")) }
    );
    return ok(result, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}

/** DELETE /api/admin/releases/versions/:id/assets/:assetId — 删除架构包 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const { id: versionId, assetId } = await params;
    await deleteAsset(versionId, assetId, {
      actorUserId: session.user.id,
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok({ id: assetId }, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
