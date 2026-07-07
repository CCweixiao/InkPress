import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { safeEqual } from "@/lib/security/random";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("license:key-vault");

const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;
let warnedDevKey = false;

function configuredViewPassword(): string {
  const password = process.env.LICENSE_KEY_VIEW_PASSWORD?.trim();
  if (password) return password;
  if (process.env.NODE_ENV !== "production") return "123456";
  return "";
}

export function verifyLicenseKeyViewPassword(input: string): boolean {
  const expected = configuredViewPassword();
  if (!expected) return false;
  const inputHash = createHash("sha256").update(input).digest("hex");
  const expectedHash = createHash("sha256").update(expected).digest("hex");
  return safeEqual(inputHash, expectedHash);
}

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.LICENSE_KEY_ENCRYPTION_SECRET?.trim();
  if (raw) {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) {
      cachedKey = decoded;
      return decoded;
    }
    log.warn("LICENSE_KEY_ENCRYPTION_SECRET 非 32 字节 base64，回退派生密钥");
  }

  const fallback =
    process.env.LICENSE_KEY_PEPPER?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production" ? configuredViewPassword() : "");
  if (!fallback) {
    throw new Error("未配置 LICENSE_KEY_ENCRYPTION_SECRET");
  }
  if (!warnedDevKey) {
    log.warn("LICENSE_KEY_ENCRYPTION_SECRET 未设置，使用派生密钥（建议生产显式配置）");
    warnedDevKey = true;
  }
  cachedKey = createHash("sha256").update(fallback).digest();
  return cachedKey;
}

export function encryptLicenseKey(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

export function decryptLicenseKey(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("License key 密文长度异常");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

