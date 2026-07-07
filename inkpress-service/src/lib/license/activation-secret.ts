import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("license:activation-secret");

/**
 * activationSecret：激活时下发的对称密钥，用于 validate/deactivate 的 HMAC 请求签名（PDC §5.3）。
 *
 * HMAC 验签需要服务端能还原密钥，因此**不能只存哈希**：用 AES-256-GCM 加密密文入库（`activationSecretEnc`），
 * KEK 来自 env；`activationSecretHash` 仅存 sha256(secret) 指纹用于日志关联。
 *
 * 密文结构：base64( iv(12) ‖ ciphertext ‖ authTag(16) )。
 */

const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKek: Buffer | null = null;
let warnedDerivedKek = false;

/** KEK：env ACTIVATION_SECRET_KEK（base64，32 字节）；缺省从 NEXTAUTH_SECRET 派生并 warn。 */
function getKek(): Buffer {
  if (cachedKek) return cachedKek;
  const raw = process.env.ACTIVATION_SECRET_KEK?.trim();
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) {
      cachedKek = buf;
      return buf;
    }
    log.warn("ACTIVATION_SECRET_KEK 非 32 字节 base64，回退派生密钥");
  }
  if (!warnedDerivedKek) {
    log.warn("ACTIVATION_SECRET_KEK 未设置，从 NEXTAUTH_SECRET 派生（仅开发）");
    warnedDerivedKek = true;
  }
  const derived = createHash("sha256")
    .update(process.env.NEXTAUTH_SECRET ?? "inkpress-dev-insecure-kek")
    .digest();
  cachedKek = derived;
  return derived;
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", getKek(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

function decrypt(enc: string): string {
  const buf = Buffer.from(enc, "base64");
  if (buf.length < IV_LEN + TAG_LEN) throw new Error("activationSecretEnc 长度异常");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", getKek(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export interface GeneratedSecret {
  /** 明文密钥，仅激活响应返回一次（幂等重激活解密复用） */
  plaintext: string;
  /** AES-256-GCM 密文，入库 */
  enc: string;
  /** sha256(secret) 指纹，入库（日志关联用） */
  fingerprint: string;
}

export function generateActivationSecret(): GeneratedSecret {
  const plaintext = randomBytes(32).toString("base64url");
  return {
    plaintext,
    enc: encrypt(plaintext),
    fingerprint: createHash("sha256").update(plaintext).digest("hex"),
  };
}

/** 从密文还原明文密钥，用于验签。失败抛错（视为密钥不可用，调用方转 SIGNATURE_INVALID）。 */
export function decryptActivationSecret(enc: string): string {
  return decrypt(enc);
}
