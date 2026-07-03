import type { NextAuthConfig } from "next-auth";
import type { AuthToken } from "@/lib/auth/types";

/**
 * Edge 安全的 NextAuth 基础配置（供 middleware 使用）。
 *
 * 关键约束：middleware 运行在 Edge Runtime，不能 import Prisma / argon2。
 * 因此本文件只包含：页面路径、session 策略、cookie/主机设置，
 * 以及「不触达数据库」的 session / authorized 回调。
 * 需要数据库的 jwt（回填 role）/ signIn（禁用校验）回调放在 src/auth.ts（Node 运行时）。
 */
export const authConfig = {
  session: { strategy: "jwt" },
  trustHost: true,
  useSecureCookies: process.env.SECURE_COOKIES === "true",
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [], // edge 配置留空，由 src/auth.ts 注入 Credentials/GitHub
  callbacks: {
    // token → session 映射（纯内存，无 DB），middleware 与服务端共用
    session({ session, token }) {
      if (token && session.user) {
        const t = token as AuthToken;
        session.user.id = t.id ?? session.user.id ?? "";
        session.user.role = t.role ?? "USER";
        session.user.status = t.status ?? "ACTIVE";
        session.user.mustChangePassword = t.mustChangePassword ?? false;
      }
      return session;
    },
    // middleware 路由保护（edge 端判定，无需 DB）
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const path = request.nextUrl.pathname;

      if (path.startsWith("/admin")) {
        if (!isLoggedIn) return false;
        if (auth!.user.role !== "ADMIN") {
          return Response.redirect(new URL("/dashboard", request.nextUrl.origin));
        }
        return true;
      }
      if (path.startsWith("/dashboard")) {
        return isLoggedIn;
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
