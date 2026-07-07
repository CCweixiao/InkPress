import { AlipaySdk } from "alipay-sdk";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("payment:alipay");

/**
 * 支付宝 SDK 单例（当面付）。
 *
 * 凭证从环境变量读取：
 * - ALIPAY_APP_ID：应用 APPID
 * - ALIPAY_APP_PRIVATE_KEY：应用私钥（绝对保密，仅服务端持有）
 * - ALIPAY_PUBLIC_KEY：支付宝公钥（用于验签回调）
 * - ALIPAY_ENCRYPT_KEY：接口内容加密 AES 密钥（沙箱已启用）
 * - ALIPAY_GATEWAY：网关地址（沙箱 / 生产）
 * - ALIPAY_KEY_TYPE：私钥格式，PKCS8（默认，沙箱密钥工具产出）或 PKCS1
 *
 * 私钥/公钥/encryptKey 含换行符时，在 .env 里通常以 \n 转义存储，
 * 运行时 .replace(/\\n/g, "\n") 还原为合法 PEM。
 * 沙箱/生产密钥工具产出的单行 base64（无 PEM 头尾）也能直接用，
 * SDK 的 formatKey 会自动包裹 BEGIN/END。
 */
let cached: AlipaySdk | null = null;

export function getAlipayClient(): AlipaySdk {
  if (cached) return cached;

  const appId = process.env.ALIPAY_APP_ID?.trim();
  const privateKey = process.env.ALIPAY_APP_PRIVATE_KEY?.trim().replace(/\\n/g, "\n");
  const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY?.trim().replace(/\\n/g, "\n");
  const encryptKey = process.env.ALIPAY_ENCRYPT_KEY?.trim().replace(/\\n/g, "\n");
  const gateway =
    process.env.ALIPAY_GATEWAY?.trim() ||
    "https://openapi-sandbox.dl.alipaydev.com/gateway.do";
  // 支付宝密钥工具默认产出 PKCS1；少数场景产出 PKCS8
  const keyType = (process.env.ALIPAY_KEY_TYPE?.trim() || "PKCS1") as "PKCS1" | "PKCS8";

  if (!appId || !privateKey) {
    throw new Error("支付宝凭证未配置（ALIPAY_APP_ID / ALIPAY_APP_PRIVATE_KEY）");
  }

  cached = new AlipaySdk({
    appId,
    privateKey,
    alipayPublicKey,
    signType: "RSA2",
    gateway,
    encryptKey,
    keyType,
  });
  log.info(
    { gateway, hasEncryptKey: Boolean(encryptKey), keyType },
    "支付宝 SDK 已初始化"
  );
  return cached;
}
