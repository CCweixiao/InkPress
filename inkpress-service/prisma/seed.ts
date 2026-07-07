import "dotenv/config";
import { ensureInitialAdmin } from "../src/lib/auth/init-admin";
import { seedPlans } from "../src/lib/plan/seed-plans";
import { prisma } from "../src/lib/db";

/**
 * Prisma seed：初始化 / 同步管理员 + 内置订阅计划。
 *
 * 调用方式：pnpm db:seed
 *
 * 行为：
 * - admin：无则创建；admin 存在则按 ADMIN_PASSWORD 同步密码（与生产 init 一致）
 * - plans：已存在的 slug 一律跳过，永不覆盖（保留管理员 UI 的手动调价）
 */
async function main() {
  const result = await ensureInitialAdmin();
  if (!result.ok) {
    console.error("[seed] 跳过管理员初始化：", result.reason);
  } else if (result.created) {
    console.log(`[seed] 已创建管理员：${result.email}`);
  } else if (result.synced) {
    console.log(`[seed] 管理员密码已同步：${result.email}`);
  } else {
    console.log(`[seed] 管理员密码与配置一致：${result.email}`);
  }

  const { created, skipped } = await seedPlans(prisma);
  console.log(
    `[seed] plans 完成：新增 ${created} / 跳过 ${skipped}（已存在不覆盖）`
  );
}

main()
  .catch((err) => {
    console.error("[seed] 失败：", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
