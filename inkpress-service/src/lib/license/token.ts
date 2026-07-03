import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("license:token");

/**
 * License Token：服务端 Ed25519 非对称签发（PDC §5.2）。
 *
 * - 客户端只内置公钥，服务端保管私钥；无法被伪造。
 * - 形态 `base64url(payloadJson).base64url(signature)`，自包含、无第三方 JWT 库。
 * - 较短有效期（24h），每次 validate 重签；客户端即便缓存旧 token 也必须校 tokenExpiresAt/nextCheckAt。
 *
 * 密钥来源：env `LICENSE_TOKEN_PRIVATE_KEY`（PKCS8 PEM）/ `LICENSE_TOKEN_PUBLIC_KEY`（SPKI PEM）。
 * 开发缺省：惰性生成内存临时密钥并 warn（重启即失效，仅本地可用）。
 */

export const TOKEN_TTL_SEC = 24 * 60 * 60; // token 自身有效期
export const NEXT_CHECK_SEC = 60 * 60; // 建议下次校验间隔
export const OFFLINE_GRACE_SEC = 72 * 60 * 60; // 离线宽限期（PDC §4.5 建议 72h）

export interface LicenseTokenPayload {
  iss: "inkpress-service";
  aud: "inkpress-client";
  activationId: string;
  licenseId: string;
  deviceId: string;
  status: "ACTIVE";
  effectiveExpiresAt: string | null;
  maxDevices: number;
  issuedAt: string;
  nextCheckAt: string;
  tokenExpiresAt: string;
}

interface KeyPair {
  privateKey: ReturnType<typeof createPrivateKey>;
  publicKey: ReturnType<typeof createPublicKey>;
}

let cached: KeyPair | null = null;
let warnedEphemeral = false;

function loadFromEnv(): KeyPair | null {
  const privPem = process.env.LICENSE_TOKEN_PRIVATE_KEY?.trim();
  const pubPem = process.env.LICENSE_TOKEN_PUBLIC_KEY?.trim();
  if (privPem) {
    try {
      const privateKey = createPrivateKey(privPem);
      // 若同时提供公钥则直接用，否则从私钥派生（Ed25519 公钥可由私钥确定）
      const publicKey = pubPem ? createPublicKey(pubPem) : createPublicKey(privateKey);
      return { privateKey, publicKey };
    } catch (err) {
      log.error({ err }, "LICENSE_TOKEN_PRIVATE_KEY 解析失败，回退临时密钥");
    }
  }
  return null;
}

function ephemeral(): KeyPair {
  if (!warnedEphemeral) {
    log.warn("LICENSE_TOKEN_PRIVATE_KEY 未设置，使用进程内临时密钥（仅开发，重启失效）");
    warnedEphemeral = true;
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey };
}

export function getKeyPair(): KeyPair {
  if (!cached) cached = loadFromEnv() ?? ephemeral();
  return cached;
}

/** 输出公钥 PEM（SPKI），供客户端构建期嵌入 / mock 验证读取。 */
export function getPublicKeyPem(): string {
  return getKeyPair().publicKey.export({ type: "spki", format: "pem" }).toString();
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64url");
const b64urlDecode = (s: string) => Buffer.from(s, "base64url");

/** 用当前时间签发一个 licenseToken（payload 含 issuedAt/expires）。 */
export function signLicenseToken(input: {
  activationId: string;
  licenseId: string;
  deviceId: string;
  effectiveExpiresAt: Date | null;
  maxDevices: number;
}): string {
  const now = Date.now();
  const payload: LicenseTokenPayload = {
    iss: "inkpress-service",
    aud: "inkpress-client",
    activationId: input.activationId,
    licenseId: input.licenseId,
    deviceId: input.deviceId,
    status: "ACTIVE",
    effectiveExpiresAt: input.effectiveExpiresAt
      ? new Date(input.effectiveExpiresAt).toISOString()
      : null,
    maxDevices: input.maxDevices,
    issuedAt: new Date(now).toISOString(),
    nextCheckAt: new Date(now + NEXT_CHECK_SEC * 1000).toISOString(),
    tokenExpiresAt: new Date(now + TOKEN_TTL_SEC * 1000).toISOString(),
  };
  const payloadJson = JSON.stringify(payload);
  const data = Buffer.from(payloadJson, "utf8");
  const sig = sign(null, data, getKeyPair().privateKey);
  return `${b64url(data)}.${b64url(sig)}`;
}

/** 校验签名与 tokenExpiresAt；失败返回 null（调用方据此跳激活页）。 */
export function verifyLicenseToken(token: string): LicenseTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const data = b64urlDecode(parts[0]);
  const sig = b64urlDecode(parts[1]);
  const ok = verify(null, data, getKeyPair().publicKey, sig);
  if (!ok) return null;
  let payload: LicenseTokenPayload;
  try {
    payload = JSON.parse(data.toString("utf8")) as LicenseTokenPayload;
  } catch {
    return null;
  }
  if (new Date(payload.tokenExpiresAt).getTime() <= Date.now()) return null;
  return payload;
}
