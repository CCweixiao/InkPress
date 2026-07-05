import { NextRequest } from "next/server";
import { assertReleaseToken } from "@/lib/release/token";
import { registerRelease } from "@/lib/release/service";
import { registerReleaseSchema } from "@/lib/validation/schemas";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * POST /api/releases/register — CI 制品登记（核心入口）。
 *
 * 鉴权：X-Release-Token（共享密钥，timingSafeEqual 比对）
 * 行为：upsert on (packageName, platform, version) → 同版本覆盖，新版本插入
 *
 * 关键：CI 不携带 status 字段，upsert 的 update 分支也不含 status，
 * 保护管理员审核过的 HIDDEN 状态。
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    // 1. 鉴权（必须是请求体解析之前，避免无效 token 浪费资源）
    assertReleaseToken(req.headers.get("x-release-token"));

    // 2. 解析 + zod 校验
    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 64 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = registerReleaseSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }

    // 3. upsert
    const result = await registerRelease(parsed.data, {
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });

    return ok(result, { status: result.action === "created" ? 201 : 200, requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
