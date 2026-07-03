import type { MailMessage } from "./types";

/**
 * 注册验证码邮件模板。
 * 明文 code 仅出现在邮件正文（DB 仅存 codeHash）。
 */
export function renderRegisterCodeEmail(
  to: string,
  code: string,
  expiresInMinutes = 10
): MailMessage {
  return {
    to,
    subject: `【InkPress】你的注册验证码 ${code}`,
    text: `你的 InkPress 注册验证码是：${code}\n该验证码 ${expiresInMinutes} 分钟内有效，请尽快完成注册。\n如非本人操作，请忽略本邮件。`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
        <h2 style="margin:0 0 16px">InkPress 注册验证码</h2>
        <p style="margin:0 0 16px;color:#475569">你正在注册 InkPress 账号，验证码为：</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f1f5f9;border-radius:8px;padding:16px;text-align:center">${code}</div>
        <p style="margin:16px 0 0;color:#475569">该验证码 ${expiresInMinutes} 分钟内有效。如非本人操作，请忽略本邮件。</p>
      </div>`,
  };
}
