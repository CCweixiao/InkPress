import "dotenv/config";
import { ensureInitialAdmin } from "../src/lib/auth/init-admin";

/**
 * Prisma seed：初始化 / 同步管理员。
 * 行为：无 admin 则创建；admin 存在则按 ADMIN_PASSWORD 同步密码。
 */
async function main() {
  const result = await ensureInitialAdmin();
  if (!result.ok) {
    console.error("[seed] 跳过管理员初始化：", result.reason);
    return;
  }
  if (result.created) {
    console.log(`[seed] 已创建管理员：${result.email}`);
  } else if (result.synced) {
    console.log(`[seed] 管理员密码已同步：${result.email}`);
  } else {
    console.log(`[seed] 管理员密码与配置一致：${result.email}`);
  }
}

main()
  .catch((err) => {
    console.error("[seed] 失败：", err);
    process.exit(1);
  })
  .finally(() => {
    const { prisma } = require("../src/lib/db");
    prisma.$disconnect();
  });
