import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { changePasswordSchema } from "@/lib/validation/schemas";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { readJsonBody } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("me:password");

/**
 * POST /api/me/password — 修改密码（session 保护）。
 *
 * **管理员禁用**：admin 密码由 .env.production 的 ADMIN_PASSWORD 管理，
 * 单一来源、每次发布自动同步。普通用户可改自己的密码。
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const session = await auth();
  if (!session?.user?.id) {
    return fail(ErrorCode.UNAUTHORIZED, { message: "请先登录", requestId });
  }

  // 管理员密码由配置文件管理，禁止自行修改
  if (session.user.role === "ADMIN") {
    return fail(ErrorCode.FORBIDDEN, {
      message: "管理员密码由部署配置（ADMIN_PASSWORD）管理，无法在界面修改",
      requestId,
    });
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, { limitBytes: 16 * 1024 });
  } catch (err) {
    return failFromError(err, requestId);
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
