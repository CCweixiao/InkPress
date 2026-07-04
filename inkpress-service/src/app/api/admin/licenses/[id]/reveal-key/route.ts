import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { revealLicenseKey } from "@/lib/license/admin-service";
import { getClientIp, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

const revealSchema = z.object({
  password: z.string().min(1).max(256),
});

/** POST /api/admin/licenses/:id/reveal-key — 管理员输入查看密码后解密展示 License Key。 */
export async function POST(
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
    const parsed = revealSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }

    const result = await revealLicenseKey(id, parsed.data.password, {
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

