/**
 * Gate cookie：HMAC 签名的廉价许可标记，供 Edge middleware 快速重定向。
 *
 * 设计动机：昂贵的 node-crypto license 检查留在 server route / instrumentation；
 * Edge middleware 只读这个签名 cookie 做廉价放行/拦截。
 *
 * Cookie 内容：`<base64url(jsonPayload)>.<base64url(hmacSig)>`
 * - payload: { allowed: boolean, mode: string, exp: number(unix ms) }
 * - HMAC-SHA256，密钥从 process.env.__INKPRESS_GATE_KEY（instrumentation 注入）
 *
 * Edge runtime 限制：不能用 fs/crypto.createHmac 需改用 Web Crypto。
 * 但 Next.js Edge 对 node:crypto 的 createHmac 已支持（@vercel/edge），保险起见
 * 这里用 Web Crypto API（SubtleCrypto.sign），Node 与 Edge 均可用。
 */

export const GATE_COOKIE_NAME = "ip-gate";
/** Cookie TTL：5 分钟（毫秒）。 */
export const GATE_COOKIE_TTL_MS = 5 * 60 * 1000;

export type GatePayload = {
  allowed: boolean;
  mode: string;
  exp: number; // unix ms
};

/** 获取 gate HMAC 密钥（注入到 env，Edge 可读）。 */
function getGateKey(): string {
  const key = process.env.__INKPRESS_GATE_KEY;
  if (!key) {
    // 无密钥时回退（仅开发态；instrumentation 应已注入）
    return "inkpress-gate-fallback-dev-only";
  }
  return key;
}

async function importHmacKey(): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(getGateKey());
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

const b64urlEncode = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64urlDecode = (s: string): Uint8Array => {
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** 确保 Uint8Array 底层是 ArrayBuffer（非 SharedArrayBuffer），满足 BufferSource 类型约束。 */
function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** 签发 gate cookie 值（Node runtime 调用，写入 Set-Cookie）。 */
export async function signGate(payload: Omit<GatePayload, "exp">, ttlMs = GATE_COOKIE_TTL_MS): Promise<string> {
  const full: GatePayload = {
    ...payload,
    exp: Date.now() + ttlMs,
  };
  const json = JSON.stringify(full);
  const dataB64 = b64urlEncode(new TextEncoder().encode(json));
  const key = await importHmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataB64));
  return `${dataB64}.${b64urlEncode(sig)}`;
}

/** 校验 gate cookie 值（Edge runtime 调用）。返回 null 表示无效/过期。 */
export async function verifyGate(cookieValue: string | null | undefined): Promise<GatePayload | null> {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [dataB64, sigB64] = parts;
  if (!dataB64 || !sigB64) return null;

  try {
    const key = await importHmacKey();
    const dataBytes = new TextEncoder().encode(dataB64);
    const sigBytes = b64urlDecode(sigB64);
    const ok = await crypto.subtle.verify("HMAC", key, toBufferSource(sigBytes), dataBytes);
    if (!ok) return null;

    const jsonBytes = b64urlDecode(dataB64);
    const json = new TextDecoder().decode(jsonBytes);
    const payload = JSON.parse(json) as GatePayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
