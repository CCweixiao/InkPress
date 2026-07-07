/**
 * 内置订阅计划数据 + 幂等 seed 函数。
 *
 * 共享给：
 * - `prisma/seed.ts`（本地开发：pnpm db:seed）
 * - `scripts/init-production.ts`（生产初始化：docker-entrypoint 调用）
 *
 * 设计约束：
 * - **不依赖 `@/` 别名**：生产 init 脚本刻意保持独立（避免 tsconfig paths 解析问题），
 *   所以本模块只导出纯数据 + 接受 prisma client 入参的函数。
 * - **结构性类型**：避免耦合 PrismaClient 类型，调用方传任何具有 subscriptionPlan
 *   字段的对象即可。
 *
 * 策略：
 * - 首次部署：按硬编码创建 4 个默认 plan
 * - 升级/重启：**已存在的 plan 一律跳过**，永不覆盖
 *   → 管理员在 /admin/plans 的手动调价持久化
 *   → 如需推送新的 plan 配置，通过 admin UI 或单独的 SQL 迁移
 *   → 这条边界保证「后续版本发布不破坏既有数据」
 */

export type SeedPlanDurationKind = "YEAR_1" | "YEAR_3" | "YEAR_5" | "PERMANENT";

export interface SeedPlan {
  slug: string;
  name: string;
  tagline: string;
  durationKind: SeedPlanDurationKind;
  durationYears: number | null;
  maxDevices: number;
  priceCents: number;
  discountPriceCents: number;
  features: string[];
  highlight: "popular" | "best_value" | null;
  sortOrder: number;
}

export const SEED_PLANS: SeedPlan[] = [
  {
    slug: "year_1",
    name: "1年版",
    tagline: "低门槛开始 · 适合个人轻度使用",
    durationKind: "YEAR_1",
    durationYears: 1,
    maxDevices: 1,
    priceCents: 12900,
    discountPriceCents: 8900,
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
    priceCents: 29900,
    discountPriceCents: 19900,
    features: [
      "全部功能解锁",
      "3 台设备授权（Mac/Win 通用）",
      "3 年免费更新",
      "年单价低至 ¥66",
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
    priceCents: 49900,
    discountPriceCents: 29900,
    features: [
      "全部功能解锁",
      "5 台设备授权",
      "5 年免费更新",
      "年单价低至 ¥60",
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
    priceCents: 89900,
    discountPriceCents: 49900,
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

/**
 * Prisma client 的结构化类型约束。
 * 避免直接 import PrismaClient 类型（保持模块无副作用，可被任何脚本相对引用）。
 */
interface PlanSeederClient {
  subscriptionPlan: {
    findUnique(args: {
      where: { slug: string };
    }): Promise<unknown>;
    create(args: { data: unknown }): Promise<unknown>;
  };
}

export interface SeedPlansResult {
  created: number;
  skipped: number;
}

/**
 * 幂等 seed：已存在的 slug 一律跳过，永不覆盖。
 */
export async function seedPlans(
  prisma: PlanSeederClient
): Promise<SeedPlansResult> {
  let created = 0;
  let skipped = 0;

  for (const plan of SEED_PLANS) {
    const existing = await prisma.subscriptionPlan.findUnique({
      where: { slug: plan.slug },
    });

    if (existing) {
      // 已存在 → 一律跳过（保留管理员 UI 的手动调价）
      skipped++;
      continue;
    }

    await prisma.subscriptionPlan.create({
      data: {
        slug: plan.slug,
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
        status: "ACTIVE",
      },
    });
    created++;
  }

  return { created, skipped };
}
