import { hash, verify } from "@node-rs/argon2";

/**
 * 密码哈希：argon2id（@node-rs/argon2，预编译二进制，无需 native build）。
 * hash() 默认 algorithm 即 Argon2id（@node-rs/argon2 推荐默认），故不显式传入，
 * 同时避免引用其 const enum（与 isolatedModules 不兼容）。
 * 参数参考 OWASP：memoryCost 19 MiB / timeCost 2 / parallelism 1。
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(
  password: string,
  hashed: string
): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    // 哈希格式非法等情况视为校验失败，不泄露细节
    return false;
  }
}

/** 密码复杂度规则（PDC §13 PASSWORD_INVALID） */
export function validatePasswordPolicy(password: string): string | null {
  if (password.length < 8) return "密码至少 8 位";
  if (password.length > 128) return "密码不能超过 128 位";
  if (!/[a-zA-Z]/.test(password)) return "密码需包含字母";
  if (!/\d/.test(password)) return "密码需包含数字";
  return null;
}
