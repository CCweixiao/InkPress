/* eslint-disable no-console */
/**
 * 邮件配置测试脚本。
 *
 * 用法：
 *   pnpm tsx scripts/test-email.ts <收件邮箱>
 *   pnpm tsx scripts/test-email.ts leojie@apache.org
 *
 * 行为：
 *   - 读取当前 MAIL_PROVIDER（console / smtp / resend）
 *   - 生成 6 位随机验证码，调用 renderRegisterCodeEmail + sendMail
 *   - console provider：验证码打印到 stdout + data/dev-mail.log
 *   - smtp/resend：真实发往指定收件箱
 */
import "dotenv/config";
import { sendMail, renderRegisterCodeEmail } from "@/lib/email";

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("用法: pnpm tsx scripts/test-email.ts <收件邮箱>");
    console.error("示例: pnpm tsx scripts/test-email.ts leojie@apache.org");
    process.exit(1);
  }

  const provider = process.env.MAIL_PROVIDER ?? "(未设置)";
  const smtpHost = process.env.SMTP_HOST ?? "(未设置)";
  const mailFrom = process.env.MAIL_FROM ?? "(未设置)";

  console.log("[test-email] 当前邮件配置：");
  console.log(`  MAIL_PROVIDER = ${provider}`);
  if (provider === "smtp") {
    console.log(`  SMTP_HOST     = ${smtpHost}`);
    console.log(`  SMTP_PORT     = ${process.env.SMTP_PORT ?? "(未设置)"}`);
    console.log(`  SMTP_SECURE   = ${process.env.SMTP_SECURE ?? "(未设置)"}`);
    console.log(`  SMTP_USER     = ${process.env.SMTP_USER ?? "(未设置)"}`);
    console.log(`  MAIL_FROM     = ${mailFrom}`);
  }
  console.log(`  收件人        = ${to}`);
  console.log("");

  const code = String(Math.floor(100000 + Math.random() * 900000));
  console.log(`[test-email] 生成的测试验证码: ${code}`);
  console.log("[test-email] 发送中...");
  console.log("");

  const msg = renderRegisterCodeEmail(to, code);
  const start = Date.now();
  await sendMail(msg);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("");
  console.log(`✅ 发送成功（耗时 ${elapsed}s）`);
  if (provider === "smtp" || provider === "resend") {
    console.log(`   请检查 ${to} 的收件箱（含垃圾邮件文件夹）`);
  } else {
    console.log(`   console provider：邮件未真实发送，内容已打印到上方日志`);
  }
}

main().catch((err) => {
  console.error("");
  console.error("❌ 发送失败：");
  console.error(err);
  console.error("");
  console.error("排查：");
  console.error("  1. QQ 邮箱：SMTP_PASS 必须是授权码（16 位字母），不是登录密码");
  console.error("  2. SMTP_USER 要和 MAIL_FROM 的邮箱地址一致");
  console.error("  3. 端口 465 用 SMTP_SECURE=true；端口 587 用 SMTP_SECURE=false");
  console.error("  4. 阿里云出站 25 端口默认封禁，必须用 465 或 587");
  process.exit(1);
});
