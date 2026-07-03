import type { Session } from "next-auth";
import { auth } from "@/auth";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * 管理端守卫：校验已登录且角色为 ADMIN，否则抛 AppError（route 内 try/catch → failFromError）。
 */
export async function requireAdmin(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "请先登录");
  }
  if (session.user.role !== "ADMIN") {
    throw new AppError(ErrorCode.FORBIDDEN, "需要管理员权限");
  }
  return session;
}
