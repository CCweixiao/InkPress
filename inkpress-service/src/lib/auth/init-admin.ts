import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import { hashPassword, validatePasswordPolicy } from "@/lib/security/password";

const log = moduleLogger("init-admin");

export type InitAdminResult =
  | { ok: true; created: boolean; email: string }
  | { ok: false; reason: string };

/**
 * 幂等初始化管理员（PDC §3.2 + 开放问题 5）。
 *
 * 仅当数据库中不存在任何 role=ADMIN 的用户时生效：
 * - 读取 ADMIN_EMAIL / ADMIN_PASSWORD，校验邮箱与密码策略；
 * - 创建 ADMIN 用户，emailVerified=now，mustChangePassword=true（首登强制改密）；
 * - 已存在管理员时直接返回，幂等安全。
 */
export async function ensureInitialAdmin(): Promise<InitAdminResult> {
  const existing = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { email: true },
  });
  if (existing) {
    log.info({ email: existing.email }, "管理员已存在，跳过初始化");
    return { ok: true, created: false, email: existing.email };
  }

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: "ADMIN_EMAIL 缺失或格式非法" };
  }
  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    return { ok: false, reason: `ADMIN_PASSWORD 不合规：${policyError}` };
  }

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
      mustChangePassword: true,
    },
  });

  log.info({ email }, "管理员初始化完成（首登需改密）");
  return { ok: true, created: true, email };
}
