import type { DefaultSession } from "next-auth";

/**
 * 扩展 Auth.js 的 Session/User 类型：携带 role、status、mustChangePassword。
 *
 * 说明：JWT 的扩展（id/role/...）未通过 `declare module "@auth/core/jwt"` 增强——
 * 在 pnpm 隔离安装下 @auth/core 不在项目可直接解析的路径，augmentation 无法稳定合并，
 * 且 JWT 自身带 `Record<string, unknown>` 索引签名会令扩展字段退化为 unknown。
 * 因此 JWT 侧改用显式 cast（见 src/lib/auth/types.ts 的 AuthToken），运行时等价、类型可靠。
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      status: string;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
    status?: string;
    mustChangePassword?: boolean;
  }
}
