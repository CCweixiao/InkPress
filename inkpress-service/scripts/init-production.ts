/**
 * 生产环境初始化脚本（容器启动时由 docker-entrypoint.sh 调用）。
 *
 * 设计目标：
 * - **完全独立**：不依赖 src/lib（避免 tsconfig paths alias 解析问题），直接用 prisma client + argon2
 * - **幂等**：admin 不存在则创建；plan 不存在则创建
 * - **失败不阻塞启动**：entrypoint 用 `|| true` 兜底，server.js 仍正常启动
 *
 * Admin 密码策略（与 /api/me/password 路由配合）：
 * - .env.production 的 ADMIN_EMAIL/ADMIN_PASSWORD 是单一来源
 * - 每次发布都比对：DB 哈希 vs env 密码 → 不一致则覆盖
 * - admin 不能通过 UI 改密（/api/me/password 拒绝 ADMIN role）
 * - mustChangePassword=false（密码由配置管理，无需首登改密）
 *
 * 跑法：
 *   node node_modules/tsx/dist/cli.mjs scripts/init-production.ts
 *
 * 配置（已在 .env.production）：
 *   ADMIN_EMAIL     管理员邮箱
 *   ADMIN_PASSWORD  管理员密码（每次发布与 DB 比对，不一致则同步）
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { hash, verify } from "@node-rs/argon2";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedPlans } from "../src/lib/plan/seed-plans";

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

  // 1. 查现有 admin
  const existingAdmin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, email: true, passwordHash: true, mustChangePassword: true },
  });

  // 2. 不存在 → 创建
  if (!existingAdmin) {
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
        mustChangePassword: false, // 密码由配置管理，不允许自行修改
      },
    });
    console.log(`[init] admin 已创建：${email}（密码由 ADMIN_PASSWORD 管理）`);
    return;
  }

  // 3. 存在但邮箱不一致 → 警告并跳过（运维需手工处理）
  if (existingAdmin.email !== email) {
    console.warn(
      `[init] 现有 admin 邮箱 ${existingAdmin.email} 与 ADMIN_EMAIL=${email} 不一致，跳过密码同步`
    );
    return;
  }

  // 4. 邮箱一致 → 比对密码哈希
  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    console.warn(`[init] ADMIN_PASSWORD 不合规：${policyError}，跳过密码同步`);
    return;
  }

  let passwordMatches = false;
  if (existingAdmin.passwordHash) {
    try {
      passwordMatches = await verify(existingAdmin.passwordHash, password);
    } catch {
      passwordMatches = false;
    }
  }

  if (passwordMatches && !existingAdmin.mustChangePassword) {
    console.log(`[init] admin 密码与配置一致：${email}，跳过`);
    return;
  }

  // 5. 不一致或 mustChangePassword 未清 → 同步
  const newPasswordHash = await hash(password, ARGON2_OPTIONS);
  await prisma.user.update({
    where: { id: existingAdmin.id },
    data: {
      passwordHash: newPasswordHash,
      mustChangePassword: false,
    },
  });
  console.log(
    `[init] admin 密码已同步到配置最新值：${email}${passwordMatches ? "" : "（旧密码已失效）"}`
  );
}

// ===== 内置订阅计划 =====
//
// 数据 + seedPlans() 实现已抽取到 src/lib/plan/seed-plans.ts，
// 与 prisma/seed.ts（本地开发）共享同一份数据源。
//
// 策略（与 admin UI 编辑权限的边界）：
// - 首次部署：按硬编码创建 4 个默认 plan
// - 升级/重启：**已存在的 plan 一律跳过**，永不覆盖
//   → 管理员在 /admin/plans 的手动调价持久化
//   → 这条边界保证「后续版本发布不破坏既有数据」

// ===== Main =====

async function main(): Promise<void> {
  console.log("[init-production] 开始");
  await ensureAdmin();
  const { created, skipped } = await seedPlans(prisma);
  console.log(
    `[init] plans 完成：新增 ${created} / 跳过 ${skipped}（已存在不覆盖）`
  );
  console.log("[init-production] 完成");
}

main()
  .catch((err) => {
    console.error("[init-production] 失败：", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
