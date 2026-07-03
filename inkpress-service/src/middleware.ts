import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

/**
 * 路由保护（PDC §3.3）。
 *
 * 使用 edge 安全的 authConfig，authorized 回调判定：
 * - /dashboard：需登录
 * - /admin：需登录且 role=ADMIN，否则重定向
 * 未登录由 Auth.js 自动跳转 pages.signIn（=/login）。
 */
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
