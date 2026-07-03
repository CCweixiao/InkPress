import { createHash, randomInt } from "node:crypto";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("license:key");

/**
 * License Key 生成与哈希（PDC §4.3、§6.5）。
 *
 * 格式：`INKP-<8>-<8>-<check>`，例如 `INKP-7QK4M2XP-9HDRT8NJ-3K`。
 * - 主体 16 字符取自 32 字符可读字母表（剔除 I/L/O/U/0/1），≈80 bit 熵；
 * - check 段由主体哈希派生 2 字符，便于客户端识别抄写错误；
 * - 仅 `keyHash`（peppered SHA-256）入库精确匹配，明文只在创建时返回一次；
 * - `keyFingerprint` 为明文短指纹（不含 pepper），用于日志/列表展示/排障；
 * - `displayKeySuffix` 仅末尾若干位。
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // 32 字符可读字母表
const PREFIX = "INKP";
const RANDOM_LEN = 16;
const CHECK_LEN = 2;

export interface GeneratedKey {
  plaintext: string;
  keyHash: string;
  keyFingerprint: string;
  displayKeySuffix: string;
}

function randomSegment(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(0, ALPHABET.length)];
  return s;
}

function toAlphabet(buffer: Buffer, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[buffer[i] % ALPHABET.length];
  return s;
}

export function getPepper(): string {
  return process.env.LICENSE_KEY_PEPPER ?? "";
}

/** peppered SHA-256，用于精确匹配。pepper 一旦轮换需重发所有 key。 */
export function hashKey(plaintext: string): string {
  return createHash("sha256").update(`${getPepper()}:${plaintext}`).digest("hex");
}

/** 明文不可逆短指纹（不含 pepper），用于展示与排障。 */
export function fingerprintOf(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex").slice(0, 12);
}

export function generateLicenseKey(): GeneratedKey {
  const rand = randomSegment(RANDOM_LEN);
  const check = toAlphabet(createHash("sha256").update(rand).digest(), CHECK_LEN);
  const plaintext = `${PREFIX}-${rand.slice(0, 8)}-${rand.slice(8)}-${check}`;
  if (!getPepper() && process.env.NODE_ENV === "production") {
    log.warn("LICENSE_KEY_PEPPER 未设置，生产环境强烈建议配置");
  }
  return {
    plaintext,
    keyHash: hashKey(plaintext),
    keyFingerprint: fingerprintOf(plaintext),
    displayKeySuffix: plaintext.slice(-7),
  };
}

/**
 * 计算有效到期时间。永久返回 null；其余按 durationKind/years/days 从 `from` 起算。
 * 用于首激活时写入 effectiveExpiresAt（Phase 3），所有设备共用同一过期点。
 */
export function computeEffectiveExpiresAt(
  kind: string,
  years: number | null | undefined,
  days: number | null | undefined,
  from: Date
): Date | null {
  if (kind === "PERMANENT") return null;
  const d = new Date(from.getTime());
  switch (kind) {
    case "YEAR_1":
      d.setFullYear(d.getFullYear() + 1);
      break;
    case "YEAR_3":
      d.setFullYear(d.getFullYear() + 3);
      break;
    case "YEAR_5":
      d.setFullYear(d.getFullYear() + 5);
      break;
    case "CUSTOM_YEARS":
      d.setFullYear(d.getFullYear() + (years ?? 0));
      break;
    case "CUSTOM_DAYS":
      d.setTime(d.getTime() + (days ?? 0) * 86_400_000);
      break;
    default:
      throw new Error(`未知 durationKind: ${kind}`);
  }
  return d;
}

/** 有效期模板的人类可读标签（列表/详情展示） */
export function durationLabel(
  kind: string,
  years?: number | null,
  days?: number | null
): string {
  switch (kind) {
    case "YEAR_1":
      return "1 年";
    case "YEAR_3":
      return "3 年";
    case "YEAR_5":
      return "5 年";
    case "CUSTOM_YEARS":
      return `${years ?? 0} 年`;
    case "CUSTOM_DAYS":
      return `${days ?? 0} 天`;
    case "PERMANENT":
      return "永久";
    default:
      return kind;
  }
}
