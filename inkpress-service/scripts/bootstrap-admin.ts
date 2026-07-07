/**
 * 容器启动时的「首次 admin 引导」——只做这一件事：
 *   - DB 中没有任何 ADMIN 用户 → 用 ADMIN_EMAIL/ADMIN_PASSWORD 创建一个
 *   - 已有 admin → 直接返回，不做密码同步，不做任何 mutation
 *
 * 设计原则（与 PDC init 整改一致）：
 *   - entrypoint 自动执行只允许「创建一次」，避免每次启动都按 env 覆盖密码
 *   - 后续 admin 密码同步/重置走 `pnpm admin:sync`（手动调用 init-production.ts）
 *   - 订阅计划等业务数据初始化走 versioned migration（prisma migrate deploy）
 *
 * 独立性约束：
 *   - 不依赖 src/lib（避免 tsconfig paths / alias 解析问题，可在裸 tsx + node 环境运行）
 *   - 只用 prisma client + argon2 + dotenv
 *
 * 跑法（容器 entrypoint 自动调用）：
 *   node node_modules/tsx/dist/cli.mjs scripts/bootstrap-admin.ts
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

// ===== Argon2 参数（与 src/lib/security/password.ts 保持一致） =====
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

async function bootstrapAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log("[bootstrap] ADMIN_EMAIL 缺失或格式非法，跳过 admin 引导");
    return;
  }

  // 关键：已有 admin 一律跳过，绝不按 env 覆盖密码
  const existing = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, email: true },
  });
  if (existing) {
    console.log(
      `[bootstrap] 已存在 admin（${existing.email}），跳过引导（密码同步请用 pnpm admin:sync）`
    );
    return;
  }

  // 首次创建：校验密码策略
  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    console.error(`[bootstrap] ADMIN_PASSWORD 不合规：${policyError}，跳过引导`);
    return;
  }

  // 邮箱不能被非 admin 用户占用
  const dup = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (dup) {
    console.error(`[bootstrap] 邮箱 ${email} 已被非管理员用户占用，跳过引导`);
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
      mustChangePassword: false,
    },
  });
  console.log(`[bootstrap] admin 已创建：${email}`);
}

bootstrapAdmin()
  .then(() => {
    console.log("[bootstrap] 完成");
  })
  .catch((err) => {
    console.error("[bootstrap] 失败：", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
