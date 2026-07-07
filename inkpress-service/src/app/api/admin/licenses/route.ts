import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { createLicensesBatch, listLicenses } from "@/lib/license/admin-service";
import {
  createLicenseSchema,
  paginationSchema,
  LicenseLifecycleSchema,
} from "@/lib/validation/schemas";
import { checkRateLimits, type RateLimitRule } from "@/lib/rate-limit";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

const ADMIN_WRITE_RULE = { windowSec: 60, max: 60 } as RateLimitRule;

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
    const ownerEmail = params.get("ownerEmail") ?? undefined;
    const rawLifecycle = params.get("lifecycle") ?? undefined;
    const lifecycleParse = rawLifecycle
      ? LicenseLifecycleSchema.safeParse(rawLifecycle)
      : undefined;
    if (lifecycleParse && !lifecycleParse.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: lifecycleParse.error.issues[0]?.message ?? "lifecycle 参数错误",
        requestId,
      });
    }
    const result = await listLicenses({
      page,
      pageSize,
      status,
      search,
      batchNo,
      ownerEmail,
      lifecycle: lifecycleParse?.success ? lifecycleParse.data : undefined,
    });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

/** POST /api/admin/licenses — 创建 License Key，明文仅本次返回 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const decision = checkRateLimits([
      { key: `admin:licenses:post:ip:1m:${ip}`, rule: ADMIN_WRITE_RULE },
    ]);
    if (!decision.allowed) {
      return fail(ErrorCode.RATE_LIMITED, {
        message: `请求过于频繁，请 ${decision.retryAfterSec}s 后重试`,
        requestId,
        headers: { "Retry-After": String(decision.retryAfterSec) },
      });
    }

    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 32 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = createLicenseSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }
    const result = await createLicensesBatch({
      input: parsed.data,
      createdByUserId: session.user.id,
      ip,
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
