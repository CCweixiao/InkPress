import "dotenv/config";
import { precreateOrder } from "../src/lib/payment/alipay/api";

/**
 * 沙箱 precreate 自检：验证凭证配置（私钥签名 / 公钥验签 / 加密 key）是否正确。
 *
 * 这是最关键的第一步——如果 precreate 都调不通，后面的回调/发券都无从谈起。
 * 成功 → 说明 ALIPAY_APP_ID / PRIVATE_KEY / PUBLIC_KEY / ENCRYPT_KEY 配置正确。
 *
 * pnpm tsx scripts/test-precreate.ts
 * pnpm tsx scripts/test-precreate.ts INKP20260704 0.01  # 自定义参数
 */
async function main() {
  const outTradeNo = process.argv[2] || `TEST${Date.now()}`;
  const amount = Number(process.argv[3] ?? 0.01);

  console.log("调用 alipay.trade.precreate...");
  console.log("  outTradeNo:", outTradeNo);
  console.log("  amount:", amount, "元");
  console.log("  gateway:", process.env.ALIPAY_GATEWAY);
  console.log("  keyType:", process.env.ALIPAY_KEY_TYPE ?? "PKCS8");
  console.log();

  try {
    const { qrCode } = await precreateOrder({
      outTradeNo,
      totalAmount: amount,
      subject: "InkPress 沙箱自检",
      notifyUrl: process.env.ALIPAY_NOTIFY_URL || "https://www.example.com/notify",
    });
    console.log("✓ precreate 成功！");
    console.log("  qrCode:", qrCode);
    console.log();
    console.log("把上面的 qrCode 粘贴到 https://cli.im/url 生成二维码图片，");
    console.log("用支付宝沙箱买家 App 扫码即可进入支付页（沙箱环境不会真扣款）。");
  } catch (err) {
    console.error("✗ precreate 失败：");
    console.error("  message:", err instanceof Error ? err.message : err);
    console.error();
    console.error("常见原因：");
    console.error("  1. 私钥格式错误：尝试切换 ALIPAY_KEY_TYPE=PKCS1 / PKCS8");
    console.error("  2. sign 错误：ALIPAY_APP_PRIVATE_KEY 与上传到沙箱的应用公钥不匹配");
    console.error("  3. 公钥错误：ALIPAY_PUBLIC_KEY 不是沙箱「支付宝公钥」（注意不是应用公钥）");
    console.error("  4. 加密错误：ALIPAY_ENCRYPT_KEY 与沙箱「接口内容加密方式」不一致");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
