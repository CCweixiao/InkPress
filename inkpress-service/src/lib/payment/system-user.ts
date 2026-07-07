/**
 * 系统发券账号：在线支付成功后自动发券的 createdByUserId。
 *
 * 由管理员通过 `ADMIN_EMAIL=system@inkpress.local pnpm init-admin` 创建，
 * 把得到的用户 ID 填入 PAYMENT_SYSTEM_USER_ID。
 *
 * 不校验 DB 存在性（避免每次发券多一次查询），未配置时直接抛错暴露配置遗漏。
 */
export function getSystemUserId(): string {
  const id = process.env.PAYMENT_SYSTEM_USER_ID?.trim();
  if (!id) {
    throw new Error(
      "PAYMENT_SYSTEM_USER_ID 未配置：请用 ADMIN_EMAIL=system@inkpress.local pnpm init-admin 创建系统发券账号后填入其 ID"
    );
  }
  return id;
}
