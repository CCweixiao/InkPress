import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { uploadAsset } from "@/lib/release/service";
import { ReleaseOsSchema, ReleaseArchSchema } from "@/lib/validation/schemas";
import { getClientIp, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/** 单 asset 上限 2GB */
const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * POST /api/admin/releases/versions/:id/assets — 上传架构包（multipart/form-data）。
 *
 * 表单字段：
 *   - os: darwin | win32 | linux
 *   - arch: arm64 | x64
 *   - file: 二进制文件
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const { id: versionId } = await params;

    const formData = await req.formData();
    const osRaw = formData.get("os");
    const archRaw = formData.get("arch");
    const file = formData.get("file");

    if (typeof osRaw !== "string" || typeof archRaw !== "string" || !(file instanceof File)) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "需要 os、arch（字符串）和 file（文件）字段",
        requestId,
      });
    }

    const os = ReleaseOsSchema.safeParse(osRaw);
    const arch = ReleaseArchSchema.safeParse(archRaw);
    if (!os.success || !arch.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "os 或 arch 取值不合法",
        requestId,
      });
    }
    if (file.size > MAX_ASSET_BYTES) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: `文件超过上限 2GB（当前 ${(file.size / 1024 / 1024 / 1024).toFixed(2)}GB）`,
        requestId,
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadAsset(
      versionId,
      { os: os.data, arch: arch.data, fileName: file.name, buffer },
      { actorUserId: session.user.id, ip, ua: truncateUa(req.headers.get("user-agent")) }
    );
    return ok(result, { status: 201, requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
