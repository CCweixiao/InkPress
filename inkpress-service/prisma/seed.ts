import "dotenv/config";
import { ensureInitialAdmin } from "../src/lib/auth/init-admin";

/**
 * Prisma seed：仅幂等初始化管理员。
 * 仅在数据库无 ADMIN 时生效（开放问题 5 推荐）。
 */
async function main() {
  const result = await ensureInitialAdmin();
  if (!result.ok) {
    console.error("[seed] 跳过管理员初始化：", result.reason);
    return;
  }
  console.log(
    result.created
      ? `[seed] 已创建管理员：${result.email}（首登需改密）`
      : `[seed] 管理员已存在：${result.email}`
  );
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
