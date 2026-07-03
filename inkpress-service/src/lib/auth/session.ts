import type { Session } from "next-auth";
import { auth } from "@/auth";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * 在 route handler / server component 中获取当前 session；
 * 无 session 时抛 AppError(UNAUTHORIZED)，由调用方 try/catch → failFromError。
 */
export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "请先登录");
  }
  return session;
}
