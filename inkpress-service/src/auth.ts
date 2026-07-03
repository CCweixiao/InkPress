import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { authConfig } from "@/auth.config";
import type { AuthToken } from "@/lib/auth/types";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/security/password";
import { ensureUserInvitationCode } from "@/lib/invite-code";
import { loginSchema } from "@/lib/validation/schemas";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("auth");

/**
 * Auth.js v5 完整配置（Node 运行时）。
 *
 * 继承 edge 安全的 authConfig（页面/cookie/session+authorized 回调），
 * 在此追加：Prisma 适配器、Credentials/GitHub provider、需要数据库的 jwt/signIn 回调、
 * createUser 事件（OAuth 新用户补发邀请码）。
 *
 * - Credentials：邮箱 + argon2 密码校验，authorize 返回含 role/status 的用户。
 * - session=jwt：Credentials 必须 JWT；role/status/mustChangePassword 写入 token。
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    ...(process.env.GITHUB_ID && process.env.GITHUB_SECRET
      ? [
          GitHub({
            clientId: process.env.GITHUB_ID,
            clientSecret: process.env.GITHUB_SECRET,
          }),
        ]
      : []),
    Credentials({
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });
        // 统一返回 null，避免泄露「邮箱是否存在」
        if (!user || !user.passwordHash) return null;
        if (user.status !== "ACTIVE") return null;
        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
          role: user.role,
          status: user.status,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ] satisfies Provider[],
  callbacks: {
    ...authConfig.callbacks,
    // 需 DB：首次登录或 token 缺 role 时回填权威字段
    async jwt({ token, user }) {
      const t = token as typeof token & AuthToken;
      const needRefresh = Boolean(user) || !t.role;
      if (needRefresh) {
        const email = (user?.email ?? t.email) ?? undefined;
        if (email) {
          const dbUser = await prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              role: true,
              status: true,
              mustChangePassword: true,
            },
          });
          if (dbUser) {
            t.id = dbUser.id;
            t.role = dbUser.role;
            t.status = dbUser.status;
            t.mustChangePassword = dbUser.mustChangePassword;
          } else if (user) {
            t.id = user.id;
            t.role = "USER";
            t.status = "ACTIVE";
            t.mustChangePassword = false;
          }
        }
      }
      return token;
    },
    // 需 DB：OAuth 路径阻止已禁用用户（Credentials 在 authorize 内已拦截）
    async signIn({ user, account }) {
      if (account && account.provider !== "credentials") {
        const email = user.email;
        if (email) {
          const dbUser = await prisma.user.findUnique({
            where: { email },
            select: { status: true },
          });
          if (dbUser && dbUser.status !== "ACTIVE") {
            log.warn({ email, status: dbUser.status }, "禁用用户尝试 OAuth 登录");
            return false;
          }
        }
      }
      return true;
    },
  },
  events: {
    async createUser(message) {
      const userId = message.user.id;
      if (userId) {
        // OAuth 新建用户补邀请码（密码注册端已在 register 内补发）
        await ensureUserInvitationCode(userId);
      }
    },
  },
});
