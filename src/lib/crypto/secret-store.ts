import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inkpressHomeDir } from "@/lib/paths";
import { moduleLogger } from "@/lib/logger";

/**
 * B7 敏感值 at-rest 加密（AES-256-GCM）。
 *
 * 背景：API key 之前明文存于 SQLite（inkpress.llm），DB 文件用户可读 / 备份即泄露。
 * 现用安装级随机密钥（~/.inkpress/.secret，0600）做对称加密，DB 只存 `v1:` 信封。
 *
 * 约束与取舍：
 * - 安装级密钥（非 OS Keychain）：server 子进程以 ELECTRON_RUN_AS_NODE 运行，无法使用
 *   Electron safeStorage（需 main 进程 + app crypto 初始化）。故采用安装级 .secret 派生密钥，
 *   作为 defense-in-depth：DB 单独泄露不再直接暴露 key；密钥与 DB 同机共存是已知边界。
 *   完整 Keychain 集成（key 读取改走 main 进程 IPC）列为后续架构演进。
 * - 惰性迁移：decryptSecret 对非 `v1:` 值直通（旧明文继续可读）；下次写入时加密落库。
 * - 幂等：encryptSecret 对已加密值直通，避免重复套娃。
 * - 密钥丢失：decryptSecret 失败返回 ""（视为未配置 key，提示用户重填），不抛错。
 */

const log = moduleLogger("crypto.secret-store");

/** 加密信封前缀（据此识别已加密值，支持惰性迁移与幂等）。 */
const ENV_PREFIX = "v1:";
/** 安装级密钥文件路径（与 DB 同属 inkpressHome，0600；不入导出包）。 */
const SECRET_PATH = path.join(inkpressHomeDir(), ".secret");

let cachedKey: Buffer | null = null;

/** 读取或创建安装级密钥，并用 SHA-256 派生 32 字节 AES 密钥。 */
function getOrCreateSecretKey(): Buffer {
  if (cachedKey) return cachedKey;
  try {
    if (fs.existsSync(SECRET_PATH)) {
      cachedKey = deriveKey(fs.readFileSync(SECRET_PATH, "utf8").trim());
      return cachedKey;
    }
  } catch (e) {
    log.warn({ err: e }, "读取安装密钥失败，将重建");
  }
  // 首次：生成 32 字节随机，base64 写入（0600）。
  const bytes = crypto.randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    fs.writeFileSync(SECRET_PATH, bytes.toString("base64"), { mode: 0o600 });
    cachedKey = deriveKey(bytes.toString("base64"));
    log.info({ path: SECRET_PATH }, "已创建安装级加密密钥");
    return cachedKey;
  } catch (e) {
    log.error({ err: e }, "创建安装密钥失败");
    throw new Error("无法初始化加密密钥存储");
  }
}

/** 用 SHA-256 把任意输入派生为 32 字节 AES-256 密钥。 */
function deriveKey(raw: string): Buffer {
  return crypto.createHash("sha256").update(raw).digest();
}

/** 是否为加密信封（`v1:` 前缀）。 */
export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ENV_PREFIX);
}

/**
 * 加密明文（幂等：空串返回空串；已加密直通）。
 * 返回 `v1:<ivB64>:<tagB64>:<ctB64>`。
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  if (isEncryptedSecret(plaintext)) return plaintext;
  const key = getOrCreateSecretKey();
  const iv = crypto.randomBytes(12); // GCM 推荐 96-bit nonce
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENV_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/**
 * 解密信封。
 * - 空串 → 空串；
 * - 非 `v1:` → 原样返回（惰性迁移：旧明文直通）；
 * - 解密失败（密钥变更/损坏）→ 返回 ""（视为未配置，引导用户重填），不抛错。
 */
export function decryptSecret(envelope: string): string {
  if (!envelope) return "";
  if (!isEncryptedSecret(envelope)) return envelope;
  try {
    const rest = envelope.slice(ENV_PREFIX.length);
    const [ivB64, tagB64, ctB64] = rest.split(":");
    if (!ivB64 || !tagB64 || !ctB64) return "";
    const key = getOrCreateSecretKey();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]);
    return pt.toString("utf8");
  } catch (e) {
    log.warn({ err: e }, "解密失败（密钥可能已变更），返回空串");
    return "";
  }
}
