/**
 * 生成 licenseToken 的 Ed25519 签名密钥对（PDC §5.2）。
 *
 * 用法：pnpm gen-token-key
 * 把输出的私钥填入服务端 .env 的 LICENSE_TOKEN_PRIVATE_KEY（保密，不入库/不入镜像），
 * 公钥填入 LICENSE_TOKEN_PUBLIC_KEY，并在 InkPress 客户端构建期嵌入以验签 token。
 * 开发环境若两项留空，服务端会惰性生成进程内临时密钥（重启即失效）。
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();

console.log("======== LICENSE_TOKEN_PRIVATE_KEY（服务端 .env，保密） ========");
console.log(privPem);
console.log("======== LICENSE_TOKEN_PUBLIC_KEY（.env + 客户端构建期嵌入） ========");
console.log(pubPem);
console.log("======== ACTIVATION_SECRET_KEK（.env，AES-256 KEK） ========");
console.log(randomBytes(32).toString("base64"));
console.log(
  "\n提示：以上为一次性生成的密钥材料。生产环境务必通过密钥管理服务下发，勿提交到仓库。"
);
