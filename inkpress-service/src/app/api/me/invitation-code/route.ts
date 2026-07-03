import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { ensureUserInvitationCode } from "@/lib/invite-code";
import { ok, fail, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/** GET /api/me/invitation-code — 当前用户邀请码（session 保护） */
export async function GET(req: Request) {
  const requestId = getRequestId(new Headers(req.headers));
  const session = await auth();
  if (!session?.user?.id) {
    return fail(ErrorCode.UNAUTHORIZED, { message: "请先登录", requestId });
  }

  // 安全网：理论上前置流程已补发，此处再次确保
  await ensureUserInvitationCode(session.user.id);
  const rec = await prisma.invitationCode.findUnique({
    where: { userId: session.user.id },
    select: { code: true, status: true, createdAt: true },
  });
  if (!rec) {
    return fail(ErrorCode.NOT_FOUND, { message: "邀请码不存在", requestId });
  }

  return ok(rec, { requestId });
}
