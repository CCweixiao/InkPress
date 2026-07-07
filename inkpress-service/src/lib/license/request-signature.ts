import { createHmac } from "node:crypto";
import { sha256Hex, safeEqual } from "@/lib/security/random";

/**
 * 客户端请求签名（PDC §5.3）。
 *
 * canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`
 * signature = HMAC_SHA256(activationSecret, canonical).hex
 *
 * bodyHash = sha256(rawRequestBody).hex；method 大写，path 不含 query。
 */

export function canonicalString(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyHash: string
): string {
  return [method.toUpperCase(), path, timestamp, nonce, bodyHash].join("\n");
}

export function bodyHashOf(rawBody: string): string {
  return sha256Hex(rawBody);
}

export function signRequest(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyHash: string
): string {
  const canonical = canonicalString(method, path, timestamp, nonce, bodyHash);
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

/** 常量时间比较签名。 */
export function verifyRequestSignature(
  secret: string,
  providedSignature: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyHash: string
): boolean {
  const expected = signRequest(secret, method, path, timestamp, nonce, bodyHash);
  return safeEqual(expected, providedSignature);
}
