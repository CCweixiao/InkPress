import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { createLicense, listLicenses } from "@/lib/license/admin-service";
import { createLicenseSchema, paginationSchema } from "@/lib/validation/schemas";
import { getClientIp, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

/** GET /api/admin/licenses — 列表 + 筛选（不含 keyHash） */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const params = req.nextUrl.searchParams;
    const { page, pageSize } = paginationSchema.parse({
      page: params.get("page") ?? 1,
      pageSize: params.get("pageSize") ?? 20,
    });
    const status = params.get("status") ?? undefined;
    const search = params.get("search") ?? undefined;
    const batchNo = params.get("batchNo") ?? undefined;
    const result = await listLicenses({ page, pageSize, status, search, batchNo });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

/** POST /api/admin/licenses — 创建 License Key，明文仅本次返回 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    const session = await requireAdmin();
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail(ErrorCode.VALIDATION_ERROR, { message: "请求体非法", requestId });
    }
    const parsed = createLicenseSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }
    const result = await createLicense({
      input: parsed.data,
      createdByUserId: session.user.id,
      ip: getClientIp(req.headers),
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok(result, { status: 201, requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
