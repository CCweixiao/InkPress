import { NextRequest } from "next/server";
import { listPublishedReleases } from "@/lib/release/service";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/**
 * GET /api/releases?package=inkpress&history=true
 *
 * 公开端点（无需登录）。返回该软件包所有 PUBLISHED 版本，按平台分组，
 * 每个平台取最新版作为主下载入口；history=true 时附全部历史版本。
 *
 * 包不存在（未发布过任何版本）→ 404，前端按"暂无可下载版本"处理。
 */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    const sp = req.nextUrl.searchParams;
    const packageName = sp.get("package") ?? "inkpress";
    const history = sp.get("history") === "true";

    const result = await listPublishedReleases(packageName, { history });
    if (!result) {
      return fail(ErrorCode.NOT_FOUND, {
        message: `软件包 ${packageName} 暂无可下载版本`,
        requestId,
      });
    }
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
