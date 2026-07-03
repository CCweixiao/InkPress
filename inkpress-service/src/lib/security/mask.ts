/**
 * 显式脱敏工具（PDC §9.2：日志/审计/错误响应不得输出 License 明文、验证码、密钥）。
 *
 * pino redact 覆盖「按字段名」的隐式脱敏；这里提供「按值」的显式脱敏，
 * 用于需要在日志里保留可辨识指纹（如 key 后缀、邮箱前缀）以便关联排查的场景。
 */

/**
 * License Key 脱敏：保留前缀与末 4 位，中段以 **** 替代。
 * 例：`INKP-ABCD-EFGH-12` → `INKP-****-E12`（形如 `INKP-****-XXXX`）。
 * 非预期格式（太短）则整体置 `***`，绝不泄露明文。
 */
export function maskLicenseKey(key: string | null | undefined): string {
  if (!key) return "";
  const s = String(key).trim().toUpperCase();
  // 形如 INKP-XXXX-XXXX-.. 末段至少 2 位
  const m = /^([A-Z]+)-.+([A-Z0-9]{2,})$/.exec(s);
  if (m) return `${m[1]}-****-${m[2]}`;
  return "***";
}

/**
 * 邮箱脱敏：保留首字符与域名，中段以 *** 替代。
 * 例：`admin@example.com` → `a***@example.com`。
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const s = String(email).trim();
  const at = s.lastIndexOf("@");
  if (at <= 0 || at === s.length - 1) return "***";
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}
