import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

/** SHA-256 十六进制摘要 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** 生成 6 位数字验证码（无偏采样，避免模偏差） */
export function generateNumericCode(length = 6): string {
  const max = 10 ** length;
  return String(randomInt(0, max)).padStart(length, "0");
}

/** 生成随机 hex token（默认 32 字节） */
export function generateRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** 生成 UUID v4（客户端安装 ID 等） */
export function generateUuid(): string {
  return randomBytes(16).toString("hex").replace(
    /(.{8})(.{4})(.{4})(.{4})(.{12})/,
    "$1-$2-$3-$4-$5"
  );
}

/** 常量时间字符串相等比较（用于校验码哈希等） */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
