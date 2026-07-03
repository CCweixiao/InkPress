import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { changePasswordSchema } from "@/lib/validation/schemas";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { ok, fail, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("me:password");

/**
 * POST /api/me/password — 修改密码（session 保护）。
 * 同时用于「管理员首登强制改密」流程，成功后清除 mustChangePassword。
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const session = await auth();
  if (!session?.user?.id) {
    return fail(ErrorCode.UNAUTHORIZED, { message: "请先登录", requestId });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(ErrorCode.VALIDATION_ERROR, { message: "请求体非法", requestId });
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION_ERROR, {
      message: parsed.error.issues[0]?.message ?? "参数错误",
      requestId,
    });
  }
  const { oldPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true },
  });
  if (!user?.passwordHash) {
    return fail(ErrorCode.UNAUTHORIZED, { message: "请先登录", requestId });
  }

  const valid = await verifyPassword(oldPassword, user.passwordHash);
  if (!valid) {
    return fail(ErrorCode.INVALID_CREDENTIALS, { message: "原密码错误", requestId });
  }
  if (oldPassword === newPassword) {
    return fail(ErrorCode.PASSWORD_INVALID, {
      message: "新密码不能与旧密码相同",
      requestId,
    });
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });
  log.info({ userId: user.id }, "密码已修改");
  return ok({ changed: true }, { requestId });
}
