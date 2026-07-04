import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword, validatePasswordPolicy } from "../src/lib/security/password";
import { randomBytes } from "node:crypto";

/**
 * 创建系统发券账号（role=ADMIN，仅作 order.paid 审计 actor，不用于人类登录）。
 *
 * 与 init-admin 的区别：init-admin 仅在无任何 ADMIN 时生效；
 * 本脚本专门用于已存在管理员时补建系统账号。
 *
 * 幂等：若 system@inkpress.local 已存在则直接打印其 ID。
 */
async function main() {
  const email = "system@inkpress.local";
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    console.log(`SYSTEM_USER_ID=${existing.id}`);
    console.log("NOTE: system user already exists");
    return;
  }

  // 生成随机强密码（此账号不用于登录，但 passwordHash 非空约束要求有值）
  const password = randomBytes(18).toString("base64") + "Aa1";
  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    console.error(`生成的密码不合规：${policyError}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const created = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
      emailVerified: new Date(),
      mustChangePassword: false,
    },
    select: { id: true, email: true },
  });
  console.log(`SYSTEM_USER_ID=${created.id}`);
  console.log(`Created: ${created.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
