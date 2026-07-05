import "dotenv/config";
import { ensureInitialAdmin } from "../src/lib/auth/init-admin";

/**
 * 手动初始化 / 同步管理员：pnpm init-admin
 * 幂等：无 admin 则创建；admin 存在则按 ADMIN_PASSWORD 同步密码。
 */
async function main() {
  const result = await ensureInitialAdmin();
  if (!result.ok) {
    console.error(`✗ ${result.reason}`);
    process.exit(1);
  }
  if (result.created) {
    console.log(`✓ 已创建管理员：${result.email}`);
  } else if (result.synced) {
    console.log(`✓ 管理员密码已同步：${result.email}`);
  } else {
    console.log(`✓ 管理员密码与配置一致：${result.email}`);
  }
}

main()
  .catch((err) => {
    console.error("✗ 初始化失败：", err);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  });
