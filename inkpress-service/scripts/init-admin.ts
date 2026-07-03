import "dotenv/config";
import { ensureInitialAdmin } from "../src/lib/auth/init-admin";

/**
 * 手动初始化管理员：pnpm init-admin
 * 幂等：仅无 ADMIN 时生效。
 */
async function main() {
  const result = await ensureInitialAdmin();
  if (!result.ok) {
    console.error(`✗ ${result.reason}`);
    process.exit(1);
  }
  console.log(
    result.created
      ? `✓ 已创建管理员：${result.email}（首登需改密）`
      : `✓ 管理员已存在：${result.email}`
  );
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
