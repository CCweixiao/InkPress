/**
 * JWT 上携带的业务字段（role/status/mustChangePassword + DB 用户 id）。
 *
 * 由于 Auth.js 的 JWT 类型带 `Record<string, unknown>` 索引签名，直接 `declare module`
 * 增强在 pnpm 隔离安装下不稳定，故回调内对 token 做显式 cast，按此类型读取/写入。
 */
export interface AuthToken {
  id?: string;
  role?: string;
  status?: string;
  mustChangePassword?: boolean;
}
