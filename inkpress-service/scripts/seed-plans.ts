import "dotenv/config";
import { prisma } from "../src/lib/db";

/**
 * 幂等种子：4 个订阅计划。
 *
 * 价格策略（用户给定 + 消费者心理学微调）：
 * - 1年版 ¥99→¥69：约 31% off，作为入门锚点，转化最敏感人群
 * - 3年版 ¥199→¥169：约 15% off，年单价 ¥56，标记「最受欢迎」促使从 1 年升级
 * - 5年版 ¥399→¥369：约 8% off，年单价 ¥74，强调「5 年省心」吸引重度用户
 * - 终身版 ¥599→¥569：约 5% off，10 设备，标记「最佳价值」锚定高客单
 *
 * 注：折扣逐级收窄是刻意的——年限越长原价本身越优惠，避免折扣过深蚕食毛利。
 * 管理员可随时通过 /admin/plans 调整价格、特性、亮点与状态。
 */

interface SeedPlan {
  slug: string;
  name: string;
  tagline: string;
  durationKind: "YEAR_1" | "YEAR_3" | "YEAR_5" | "PERMANENT";
  durationYears: number | null;
  maxDevices: number;
  priceCents: number;
  discountPriceCents: number;
  features: string[];
  highlight: "popular" | "best_value" | null;
  sortOrder: number;
}

const PLANS: SeedPlan[] = [
  {
    slug: "year_1",
    name: "1年版",
    tagline: "适合初次体验 / 个人轻度使用",
    durationKind: "YEAR_1",
    durationYears: 1,
    maxDevices: 1,
    priceCents: 9900,
    discountPriceCents: 6900,
    features: [
      "全部功能解锁",
      "1 台设备授权",
      "1 年免费更新",
      "邮件客服支持",
      "无广告打扰",
    ],
    highlight: null,
    sortOrder: 1,
  },
  {
    slug: "year_3",
    name: "3年版",
    tagline: "个人创作者性价比之选 · 最受欢迎",
    durationKind: "YEAR_3",
    durationYears: 3,
    maxDevices: 3,
    priceCents: 19900,
    discountPriceCents: 16900,
    features: [
      "全部功能解锁",
      "3 台设备授权（Mac/Win 通用）",
      "3 年免费更新",
      "年单价低至 ¥56",
      "优先邮件客服",
      "适合个人多设备",
    ],
    highlight: "popular",
    sortOrder: 2,
  },
  {
    slug: "year_5",
    name: "5年版",
    tagline: "长期主义者 · 5 年省心方案",
    durationKind: "YEAR_5",
    durationYears: 5,
    maxDevices: 5,
    priceCents: 39900,
    discountPriceCents: 36900,
    features: [
      "全部功能解锁",
      "5 台设备授权",
      "5 年免费更新",
      "优先客服响应",
      "适合家庭 / 小团队共享",
    ],
    highlight: null,
    sortOrder: 3,
  },
  {
    slug: "lifetime",
    name: "终身版",
    tagline: "一次买断 永久使用 · 最佳价值",
    durationKind: "PERMANENT",
    durationYears: null,
    maxDevices: 10,
    priceCents: 59900,
    discountPriceCents: 56900,
    features: [
      "全部功能解锁 · 终身权益",
      "10 台设备授权",
      "终身免费更新",
      "专属客服通道",
      "未来新特性免费获取",
      "适合工作室 / 团队",
    ],
    highlight: "best_value",
    sortOrder: 4,
  },
];

async function main() {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const plan of PLANS) {
    const existing = await prisma.subscriptionPlan.findUnique({
      where: { slug: plan.slug },
    });

    const data = {
      name: plan.name,
      tagline: plan.tagline,
      durationKind: plan.durationKind,
      durationYears: plan.durationYears,
      maxDevices: plan.maxDevices,
      priceCents: plan.priceCents,
      discountPriceCents: plan.discountPriceCents,
      featuresJson: JSON.stringify(plan.features),
      highlight: plan.highlight,
      sortOrder: plan.sortOrder,
      status: "ACTIVE" as const,
    };

    if (!existing) {
      await prisma.subscriptionPlan.create({
        data: { slug: plan.slug, ...data },
      });
      created++;
      console.log(`[seed-plan] 创建：${plan.slug}`);
      continue;
    }

    // 已存在：比对关键字段，无变化则跳过；有变化则更新（不覆盖 status，避免误启停）
    const needsUpdate =
      existing.name !== data.name ||
      existing.tagline !== data.tagline ||
      existing.durationKind !== data.durationKind ||
      existing.durationYears !== data.durationYears ||
      existing.maxDevices !== data.maxDevices ||
      existing.priceCents !== data.priceCents ||
      existing.discountPriceCents !== data.discountPriceCents ||
      existing.featuresJson !== data.featuresJson ||
      existing.highlight !== data.highlight ||
      existing.sortOrder !== data.sortOrder;

    if (!needsUpdate) {
      skipped++;
      console.log(`[seed-plan] 跳过（已一致）：${plan.slug}`);
      continue;
    }

    await prisma.subscriptionPlan.update({
      where: { slug: plan.slug },
      data,
    });
    updated++;
    console.log(`[seed-plan] 更新：${plan.slug}`);
  }

  console.log(
    `[seed-plan] 完成：新增 ${created} / 更新 ${updated} / 跳过 ${skipped}`
  );
}

main()
  .catch((err) => {
    console.error("[seed-plan] 失败：", err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
