import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { deleteObject } from "@/lib/oss";
import { readJsonBody } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    await requireSession();
    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 8 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const key = (body as { key?: string })?.key;
    if (!key || typeof key !== "string") {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "缺少 key 字段",
        requestId,
      });
    }
    // 安全校验：只允许删除 tickets/ 前缀的对象
    if (!key.startsWith("tickets/")) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "非法的 key",
        requestId,
      });
    }
    await deleteObject(key);
    return ok({ deleted: true }, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
