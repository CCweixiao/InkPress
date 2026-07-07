import "dotenv/config";
import crypto from "node:crypto";

/**
 * 诊断 ALIPAY_APP_PRIVATE_KEY 的实际格式（PKCS8 vs PKCS1）。
 * pnpm tsx scripts/diagnose-key.ts
 */
const raw = (process.env.ALIPAY_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "").trim();

console.log("私钥 base64 长度:", raw.length);
console.log("前 30 字符:", raw.slice(0, 30));
console.log();

const wrappers: Array<[string, string]> = [
  ["PKCS8", `-----BEGIN PRIVATE KEY-----\n${raw}\n-----END PRIVATE KEY-----`],
  ["PKCS1", `-----BEGIN RSA PRIVATE KEY-----\n${raw}\n-----END RSA PRIVATE KEY-----`],
];

for (const [name, keyPem] of wrappers) {
  try {
    const keyObj = crypto.createPrivateKey({ key: keyPem, format: "pem" });
    console.log(
      `✓ ${name}: 解析成功, type=${keyObj.type}, asymmetricKeyType=${keyObj.asymmetricKeyType}`
    );
    const sig = crypto.createSign("RSA-SHA256").update("test").sign(keyPem);
    console.log(`  签名测试通过: ${sig.length} 字节`);
  } catch (e) {
    console.log(
      `✗ ${name}: ${e instanceof Error ? e.message.slice(0, 100) : e}`
    );
  }
}

console.log();
console.log("结论：用能通过的那个格式设置 ALIPAY_KEY_TYPE");
