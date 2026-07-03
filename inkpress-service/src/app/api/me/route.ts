import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { ok, fail, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/** GET /api/me — 当前用户信息（session 保护） */
export async function GET(req: Request) {
  const requestId = getRequestId(new Headers(req.headers));
  const session = await auth();
  if (!session?.user?.id) {
    return fail(ErrorCode.UNAUTHORIZED, { message: "请先登录", requestId });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      status: true,
      mustChangePassword: true,
      emailVerified: true,
      createdAt: true,
    },
  });
  if (!user) {
    return fail(ErrorCode.UNAUTHORIZED, { message: "请先登录", requestId });
  }

  return ok(user, { requestId });
}
