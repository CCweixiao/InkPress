/**
 * 系统配置导入导出的加密封装（浏览器侧）。
 *
 * 安全模型：
 * - 加密在浏览器完成（Web Crypto API），密码从不离开浏览器，服务端零知识
 * - AES-256-GCM（认证加密，密文不可读 + 防篡改）
 * - PBKDF2-SHA256 × 600000 迭代派生密钥（OWASP 2023 推荐，暴力破解成本极高）
 * - 每次导出生成随机 salt + iv，相同密码导出两次密文完全不同（防彩虹表）
 *
 * 导出文件结构（ExportPayload，JSON）：
 *   { version, alg, kdf: { name, hash, iterations }, salt, iv, ciphertext }
 * salt/iv/ciphertext 均为 base64；密码不在文件里，文件泄露只能靠暴力破解。
 */

/** PBKDF2 迭代次数（兼顾安全与浏览器性能，约 0.5-1s） */
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16; // PBKDF2 salt
const IV_BYTES = 12; // AES-GCM 推荐 96-bit nonce
const KEY_BITS = 256; // AES-256

export type ExportPayload = {
  version: 1;
  alg: "AES-256-GCM";
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
  };
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64（含 GCM 认证标签）
};

// ---- base64 ↔ ArrayBuffer 互转（Web Crypto 原生只认 ArrayBuffer）----

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** 用密码派生 AES-256-GCM 密钥（PBKDF2） */
async function deriveKey(
  password: string,
  salt: BufferSource,
  iterations: number
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  // 第一步：把密码做成 PBKDF2 的基础密钥素材
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  // 第二步：派生出 AES-GCM 用的 256 位密钥
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * 加密一段明文（通常是 JSON.stringify 后的配置数组）。
 * 返回自包含的 ExportPayload，可直接 JSON.stringify 写入文件。
 */
export async function encryptConfig(
  plaintext: string,
  password: string
): Promise<ExportPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);

  const enc = new TextEncoder();
  // AES-GCM 会把认证标签附在密文末尾，解密时自动校验
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    enc.encode(plaintext)
  );

  return {
    version: 1,
    alg: "AES-256-GCM",
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: PBKDF2_ITERATIONS,
    },
    salt: bufToBase64(salt),
    iv: bufToBase64(iv),
    ciphertext: bufToBase64(ciphertext),
  };
}

/**
 * 解密 ExportPayload，返回明文。
 * 密码错误或文件被篡改时抛错（GCM 认证失败 / base64 损坏），
 * 调用方应捕获后给「密码错误或文件损坏」的友好提示。
 */
export async function decryptConfig(
  payload: ExportPayload,
  password: string
): Promise<string> {
  if (payload.version !== 1) {
    throw new Error(`不支持的配置文件版本：${payload.version}`);
  }
  if (payload.alg !== "AES-256-GCM") {
    throw new Error(`不支持的加密算法：${payload.alg}`);
  }

  const salt = base64ToBuf(payload.salt);
  const iv = base64ToBuf(payload.iv);
  const ciphertext = base64ToBuf(payload.ciphertext);
  const key = await deriveKey(password, salt, payload.kdf.iterations);

  // GCM 解密同时做认证校验，失败抛 OperationError
  const plaintextBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintextBuf);
}

/** 校验一个未知对象是否为合法的 ExportPayload（用于导入文件预检） */
export function isExportPayload(obj: unknown): obj is ExportPayload {
  if (!obj || typeof obj !== "object") return false;
  const p = obj as Record<string, unknown>;
  return (
    p.version === 1 &&
    p.alg === "AES-256-GCM" &&
    typeof p.salt === "string" &&
    typeof p.iv === "string" &&
    typeof p.ciphertext === "string" &&
    !!p.kdf &&
    typeof (p.kdf as Record<string, unknown>).iterations === "number"
  );
}
