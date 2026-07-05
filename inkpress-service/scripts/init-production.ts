/**
 * 生产环境初始化脚本（容器启动时由 docker-entrypoint.sh 调用）。
 *
 * 设计目标：
 * - **完全独立**：不依赖 src/lib（避免 tsconfig paths alias 解析问题），直接用 prisma client + argon2
 * - **幂等**：admin 已存在则跳过；plan 已一致则跳过
 * - **失败不阻塞启动**：entrypoint 用 `|| true` 兜底，server.js 仍正常启动
 *
 * 跑法：
 *   node node_modules/tsx/dist/cli.mjs scripts/init-production.ts
 *
 * 配置（已在 .env.production）：
 *   ADMIN_EMAIL     管理员邮箱
 *   ADMIN_PASSWORD  管理员初始密码（首登强制改密）
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { hash } from "@node-rs/argon2";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

// ===== Prisma client（独立构造，避免依赖 src/lib/db） =====

function resolveDbPath(): string {
  const raw = (process.env.DATABASE_URL ?? "file:./dev.db").trim();
  const stripped = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  const abs = path.isAbsolute(stripped)
    ? stripped
    : path.resolve(process.cwd(), stripped);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: resolveDbPath() }),
});

// ===== Admin 初始化（参数与 src/lib/security/password.ts 保持一致） =====
// @node-rs/argon2 默认 algorithm 即 Argon2id，参数参考 OWASP。

const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

function validatePasswordPolicy(password: string): string | null {
  if (password.length < 8) return "密码至少 8 位";
  if (password.length > 128) return "密码不能超过 128 位";
  if (!/[a-zA-Z]/.test(password)) return "密码需包含字母";
  if (!/\d/.test(password)) return "密码需包含数字";
  return null;
}

async function ensureAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log("[init] ADMIN_EMAIL 缺失或格式非法，跳过 admin 初始化");
    return;
  }

  const existing = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { email: true },
  });
  if (existing) {
    console.log(`[init] admin 已存在：${existing.email}，跳过`);
    return;
  }

  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    console.error(`[init] ADMIN_PASSWORD 不合规：${policyError}`);
    return;
  }

  const dup = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (dup) {
    console.error(`[init] 邮箱 ${email} 已被非管理员用户占用，跳过`);
    return;
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
      emailVerified: new Date(),
      mustChangePassword: true,
    },
  });
  console.log(`[init] admin 已创建：${email}（首登需改密）`);
}

// ===== 内置订阅计划 =====
//
// 策略（与 admin UI 编辑权限的边界）：
// - 首次部署：按硬编码创建 4 个默认 plan
// - 升级/重启：**已存在的 plan 一律跳过**，永不覆盖
//   → 管理员在 /admin/plans 的手动调价持久化
//   → 如需推送新的 plan 配置，通过 admin UI 或单独的 SQL 迁移
//   → 这条边界保证「后续版本发布不破坏既有数据」

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

async function seedPlans(): Promise<void> {
  let created = 0;
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
      continue;
    }

    // 已存在 → 一律跳过（见上方「策略」注释）
    skipped++;
  }

  console.log(
    `[init] plans 完成：新增 ${created} / 跳过 ${skipped}（已存在不覆盖）`
  );
}

// ===== Main =====

async function main(): Promise<void> {
  console.log("[init-production] 开始");
  await ensureAdmin();
  await seedPlans();
  console.log("[init-production] 完成");
}

main()
  .catch((err) => {
    console.error("[init-production] 失败：", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
