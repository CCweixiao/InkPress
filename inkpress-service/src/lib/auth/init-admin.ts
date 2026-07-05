import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import {
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from "@/lib/security/password";

const log = moduleLogger("init-admin");

export type InitAdminResult =
  | { ok: true; created: boolean; synced: boolean; email: string }
  | { ok: false; reason: string };

/**
 * 幂等初始化 / 同步管理员（与 scripts/init-production.ts 保持逻辑一致）。
 *
 * 行为：
 * - 无 admin → 用 ADMIN_EMAIL/ADMIN_PASSWORD 创建
 * - admin 存在且邮箱匹配 → 比对密码，不一致则更新；强制 mustChangePassword=false
 * - admin 存在但邮箱不一致 → 警告并跳过（运维手动处理）
 *
 * 设计原则：.env 的 ADMIN_PASSWORD 是 admin 密码单一来源；
 * admin 无法通过 UI 修改密码（/api/me/password 拒绝 ADMIN role）。
 */
export async function ensureInitialAdmin(): Promise<InitAdminResult> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: "ADMIN_EMAIL 缺失或格式非法" };
  }

  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    return { ok: false, reason: `ADMIN_PASSWORD 不合规：${policyError}` };
  }

  const existing = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, email: true, passwordHash: true, mustChangePassword: true },
  });

  // 1. 不存在 → 创建
  if (!existing) {
    const dup = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (dup) {
      return { ok: false, reason: `邮箱 ${email} 已被非管理员用户占用` };
    }
    const passwordHash = await hashPassword(password);
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
    log.info({ email }, "管理员已创建（密码由 ADMIN_PASSWORD 管理）");
    return { ok: true, created: true, synced: false, email };
  }

  // 2. 邮箱不一致 → 跳过
  if (existing.email !== email) {
    log.warn(
      { existingEmail: existing.email, expectedEmail: email },
      "现有 admin 邮箱与 ADMIN_EMAIL 不一致，跳过密码同步"
    );
    return {
      ok: false,
      reason: `现有 admin 邮箱 ${existing.email} 与 ADMIN_EMAIL=${email} 不一致`,
    };
  }

  // 3. 比对密码
  const passwordMatches =
    existing.passwordHash !== null &&
    (await verifyPassword(password, existing.passwordHash));
  if (passwordMatches && !existing.mustChangePassword) {
    log.info({ email }, "管理员密码与配置一致，跳过");
    return { ok: true, created: false, synced: false, email };
  }

  // 4. 不一致 → 同步
  const newPasswordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      passwordHash: newPasswordHash,
      mustChangePassword: false,
    },
  });
  log.info({ email }, "管理员密码已同步到配置最新值");
  return { ok: true, created: false, synced: true, email };
}
