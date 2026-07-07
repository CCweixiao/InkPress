import "dotenv/config";
import { prisma } from "../src/lib/db";
import { fulfillOrderIfPending } from "../src/lib/payment/order-service";

/**
 * 模拟支付宝支付成功回调（绕过验签 + 绕过真机扫码）。
 *
 * 适用场景：iPhone 无法装沙箱买家 App、没有 Android 设备时验证发券事务。
 *
 * 验证范围：
 * ✓ 金额校验（必须与订单 amountCents 完全匹配）
 * ✓ License Key 生成（generateLicenseKey + encryptLicenseKey + 冲突重试）
 * ✓ 订单状态流转 PENDING → PAID
 * ✓ 审计日志写入（order.paid，actorRole=SYSTEM）
 * ✗ 回调验签（需真实支付宝回调才能验证）
 *
 * 用法：
 *   1. 浏览器登录 → /checkout?plan=year_1 创建订单 → 从页面 URL 或 dev 日志拿 orderId
 *   pnpm tsx scripts/simulate-payment.ts <orderId>
 *
 *   2. 不传参数：列出所有 PENDING 订单供选择
 *   pnpm tsx scripts/simulate-payment.ts
 */
async function main() {
  const arg = process.argv[2];

  // 无参数：列出 PENDING 订单
  if (!arg) {
    console.log("\n===== PENDING 订单 =====");
    const pending = await prisma.order.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        outTradeNo: true,
        planName: true,
        amountCents: true,
        createdAt: true,
        user: { select: { email: true } },
      },
    });
    if (pending.length === 0) {
      console.log("（无 PENDING 订单）");
      console.log("\n先创建订单：");
      console.log("  1. 浏览器登录普通用户");
      console.log("  2. 访问 http://localhost:3001/checkout?plan=year_1");
      console.log("  3. 页面 URL 末尾的 orderId，或看 dev server 日志");
      console.log("  4. pnpm tsx scripts/simulate-payment.ts <orderId>");
    } else {
      for (const o of pending) {
        console.log(
          `  ${o.id} | ${o.outTradeNo} | ¥${o.amountCents / 100} | ${o.planName} | ${o.user.email}`
        );
      }
      console.log("\n复制上面的 id 运行：pnpm tsx scripts/simulate-payment.ts <id>");
    }
    await prisma.$disconnect();
    return;
  }

  // 查订单：支持 orderId 或 outTradeNo
  const order = arg.startsWith("INKP")
    ? await prisma.order.findUnique({
        where: { outTradeNo: arg },
        select: { id: true, outTradeNo: true, amountCents: true, status: true, planName: true },
      })
    : await prisma.order.findUnique({
        where: { id: arg },
        select: { id: true, outTradeNo: true, amountCents: true, status: true, planName: true },
      });

  if (!order) {
    console.error(`✗ 订单不存在：${arg}`);
    process.exit(1);
  }

  console.log(`\n订单：${order.outTradeNo} | ${order.planName} | ¥${order.amountCents / 100} | 当前状态 ${order.status}`);

  if (order.status === "PAID") {
    console.log("✓ 订单已支付，无需重复发券（幂等）");
    await prisma.$disconnect();
    return;
  }
  if (order.status !== "PENDING") {
    console.error(`✗ 订单状态为 ${order.status}，不能模拟支付`);
    process.exit(1);
  }

  const totalAmountYuan = (order.amountCents / 100).toFixed(2);
  console.log(`\n模拟支付成功，金额 ${totalAmountYuan} 元...`);

  await fulfillOrderIfPending({
    outTradeNo: order.outTradeNo,
    tradeNo: `SANDBOX_SIM_${Date.now()}`,
    totalAmountYuan,
    buyerLogonId: "simulate@sandbox.test",
  });

  // 验证结果
  const after = await prisma.order.findUnique({
    where: { id: order.id },
    select: {
      status: true,
      tradeNo: true,
      licenseKeyId: true,
      paidAt: true,
      buyerLogonId: true,
    },
  });
  const license = after?.licenseKeyId
    ? await prisma.licenseKey.findUnique({
        where: { id: after.licenseKeyId },
        select: { keyFingerprint: true, displayKeySuffix: true, durationKind: true, maxDevices: true, ownerEmail: true },
      })
    : null;

  console.log("\n===== 发券结果 =====");
  console.log(`  订单状态: ${after?.status}`);
  console.log(`  支付时间: ${after?.paidAt?.toISOString()}`);
  console.log(`  流水号:   ${after?.tradeNo}`);
  console.log(`  License ID: ${after?.licenseKeyId ?? "（未发放！）"}`);
  if (license) {
    console.log(`  License 指纹: ${license.keyFingerprint}`);
    console.log(`  License 后缀: …${license.displayKeySuffix}`);
    console.log(`  有效期模板:  ${license.durationKind}`);
    console.log(`  设备上限:    ${license.maxDevices}`);
    console.log(`  归属邮箱:    ${license.ownerEmail}`);
  }
  console.log("\n✓ 验证通过：支付成功后 License 已自动发放");
  console.log("\n接下来可以验证：");
  console.log("  - 浏览器刷新收银台 → 应自动跳 /checkout/success 显示 License");
  console.log("  - 访问 /dashboard/orders → 看到这条 PAID 订单");
  console.log("  - 访问 /dashboard → 看到归属的 License");
  console.log("  - pnpm tsx scripts/debug-payment.ts → 复核订单 + 系统账号");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("✗ 模拟支付失败：", e instanceof Error ? e.message : e);
  process.exit(1);
});
