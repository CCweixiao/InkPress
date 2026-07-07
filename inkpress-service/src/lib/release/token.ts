import { timingSafeEqual } from "node:crypto";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * 校验 CI 制品登记 token。
 *
 * - 服务端未配置 RELEASE_REGISTER_TOKEN → 503（避免开放注册）
 * - 请求未带 / 不匹配 → 401
 *
 * 用 timingSafeEqual 防时序攻击；先比长度，长度不同直接 false（避免 Buffer 抛错）。
 */
export function assertReleaseToken(headerValue: string | null): void {
  const expected = process.env.RELEASE_REGISTER_TOKEN;
  if (!expected) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "服务端未配置 RELEASE_REGISTER_TOKEN，拒绝登记"
    );
  }
  if (!headerValue) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "缺少 X-Release-Token 头");
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(headerValue);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "无效的 release token");
  }
}
