import "dotenv/config";
import { prisma } from "../src/lib/db";

/**
 * 调试辅助：查看现有套餐 + 最近订单，便于联调时快速确认状态。
 * pnpm tsx scripts/debug-payment.ts
 */
async function main() {
  console.log("\n===== 套餐列表 =====");
  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: { sortOrder: "asc" },
    select: {
      slug: true,
      name: true,
      priceCents: true,
      discountPriceCents: true,
      status: true,
      maxDevices: true,
      durationKind: true,
    },
  });
  if (plans.length === 0) {
    console.log("（无套餐，需在 /admin/plans 创建一个 ¥0.01 测试套餐）");
  }
  for (const p of plans) {
    const price = (p.discountPriceCents ?? p.priceCents) / 100;
    console.log(
      `  ${p.status === "ACTIVE" ? "✓" : "✗"} ${p.slug} | ${p.name} | ¥${price} | ${p.maxDevices}设备 | ${p.durationKind}`
    );
  }

  console.log("\n===== 最近 10 条订单 =====");
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      outTradeNo: true,
      status: true,
      amountCents: true,
      planName: true,
      tradeNo: true,
      licenseKeyId: true,
      createdAt: true,
      paidAt: true,
      user: { select: { email: true } },
    },
  });
  if (orders.length === 0) {
    console.log("（无订单）");
  }
  for (const o of orders) {
    console.log(
      `  ${o.outTradeNo} | ${o.status} | ¥${o.amountCents / 100} | ${o.planName} | ${o.user.email} | license:${o.licenseKeyId ?? "—"} | tradeNo:${o.tradeNo ?? "—"}`
    );
  }

  console.log("\n===== 系统发券账号 =====");
  const sysUser = await prisma.user.findUnique({
    where: { email: "system@inkpress.local" },
    select: { id: true, email: true, role: true },
  });
  if (sysUser) {
    console.log(`  id=${sysUser.id} email=${sysUser.email} role=${sysUser.role}`);
    const envId = process.env.PAYMENT_SYSTEM_USER_ID;
    if (envId && envId !== sysUser.id) {
      console.log(`  ⚠️  .env 的 PAYMENT_SYSTEM_USER_ID=${envId} 与 DB 不一致！`);
    }
  } else {
    console.log("  ⚠️ 未创建，运行: pnpm tsx scripts/create-system-user.ts");
  }

  console.log("\n===== 支付宝凭证检查 =====");
  const checks = [
    ["ALIPAY_APP_ID", process.env.ALIPAY_APP_ID],
    ["ALIPAY_APP_PRIVATE_KEY", process.env.ALIPAY_APP_PRIVATE_KEY ? "(已设置)" : "(缺失)"],
    ["ALIPAY_PUBLIC_KEY", process.env.ALIPAY_PUBLIC_KEY ? "(已设置)" : "(缺失)"],
    ["ALIPAY_ENCRYPT_KEY", process.env.ALIPAY_ENCRYPT_KEY ? "(已设置)" : "(缺失)"],
    ["ALIPAY_GATEWAY", process.env.ALIPAY_GATEWAY],
    ["ALIPAY_NOTIFY_URL", process.env.ALIPAY_NOTIFY_URL],
    ["ALIPAY_KEY_TYPE", process.env.ALIPAY_KEY_TYPE ?? "(默认 PKCS8)"],
  ];
  for (const [k, v] of checks) {
    const isPlaceholder = v?.includes("example.com");
    console.log(`  ${isPlaceholder ? "⚠️" : "✓"} ${k}=${v}`);
  }
  if (!process.env.ALIPAY_NOTIFY_URL || process.env.ALIPAY_NOTIFY_URL.includes("example.com")) {
    console.log("\n  ⚠️  ALIPAY_NOTIFY_URL 是占位符，回调无法到达！");
    console.log("     用 ngrok 暴露 3001 端口后替换：ngrok http 3001");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
