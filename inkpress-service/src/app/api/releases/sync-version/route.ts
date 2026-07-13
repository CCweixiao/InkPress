import { NextRequest } from "next/server";
import { assertReleaseToken } from "@/lib/release/token";
import { syncVersion } from "@/lib/release/service";
import { syncVersionSchema } from "@/lib/validation/schemas";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * POST /api/releases/sync-version — CI / GH Action 同步版本元信息。
 *
 * 鉴权：X-Release-Token（共享密钥）
 * 行为：upsert on (packageName, version) → 同步元信息，并由服务端拉取 GitHub Release 安装包写入 OSS
 * 语义：同版本重新打 tag → 覆盖元信息，不动 status；资产按 os+arch 幂等覆盖
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    assertReleaseToken(req.headers.get("x-release-token"));

    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 64 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = syncVersionSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }

    const result = await syncVersion(parsed.data, {
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
