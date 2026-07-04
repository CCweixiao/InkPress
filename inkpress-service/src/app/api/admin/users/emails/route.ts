import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { prisma } from "@/lib/db";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/**
 * GET /api/admin/users/emails?q=<keyword> — 归属用户下拉用的模糊搜索。
 *
 * 行为：
 * - q 为空：返回最近注册的 50 个非 DELETED 用户（按 createdAt DESC → email ASC），
 *   用于 Combobox 聚焦但未输入时的默认建议列表。
 * - q 非空：trim + lowercase 后做 contains 匹配，按 email 升序，最多 10 条。
 *   依赖 User.email 已小写规范化存储，SQLite 原生 contains 即为大小写不敏感。
 *
 * q 最长 64 字符，避免恶意超长查询。
 */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const raw = req.nextUrl.searchParams.get("q") ?? "";
    const q = raw.trim().toLowerCase();

    if (q.length === 0) {
      const rows = await prisma.user.findMany({
        where: { status: { not: "DELETED" } },
        orderBy: [{ createdAt: "desc" }, { email: "asc" }],
        take: 50,
        select: {
          email: true,
          name: true,
          status: true,
          createdAt: true,
        },
      });
      return ok(
        {
          items: rows.map((r) => ({
            email: r.email,
            name: r.name,
            status: r.status,
            createdAt: r.createdAt,
          })),
        },
        { requestId }
      );
    }

    if (q.length > 64) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "查询关键词过长",
        requestId,
      });
    }

    const rows = await prisma.user.findMany({
      where: {
        status: { not: "DELETED" },
        email: { contains: q },
      },
      orderBy: { email: "asc" },
      take: 10,
      select: { email: true, name: true, status: true, createdAt: true },
    });

    return ok(
      {
        items: rows.map((r) => ({
          email: r.email,
          name: r.name,
          status: r.status,
          createdAt: r.createdAt,
        })),
      },
      { requestId }
    );
  } catch (err) {
    return failFromError(err, requestId);
  }
}
