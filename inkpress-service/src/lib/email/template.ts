import type { MailMessage } from "./types";

const BRAND_NAME = "InkPress";
const LOGO_PATH = "/inkpress-logo.png";

function publicUrl(path: string): string | null {
  const baseUrl =
    process.env.NEXTAUTH_URL?.trim() || process.env.APP_URL?.trim() || "";
  if (!baseUrl) return null;
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return null;
  }
}

/** 通用品牌邮件外壳（注册/重置密码共用） */
function brandEnvelope(opts: {
  title: string;
  intro: string;
  code: string;
  expiresInMinutes: number;
  to: string;
  subject: string;
  securityHint: string;
}): MailMessage {
  const { title, intro, code, expiresInMinutes, to, subject, securityHint } = opts;
  const logoUrl = publicUrl(LOGO_PATH);
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" width="48" height="48" alt="InkPress" style="display:block;width:48px;height:48px;border-radius:12px" />`
    : `<div style="width:48px;height:48px;border-radius:12px;background:#2563eb;color:#ffffff;font-size:22px;font-weight:800;line-height:48px;text-align:center">IP</div>`;

  return {
    to,
    subject,
    text: [
      title,
      `验证码：${code}`,
      `验证码 ${expiresInMinutes} 分钟内有效，请尽快完成操作。`,
      intro,
      "如果这不是你本人发起的操作，请忽略本邮件。请勿将验证码转发给任何人。",
    ].join("\n"),
    html: `
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">
        ${BRAND_NAME} 验证码 ${code}，${expiresInMinutes} 分钟内有效。
      </div>
      <div style="margin:0;padding:28px 12px;background:#f6f8fb">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#101828">
          <div style="background:#ffffff;border:1px solid #e6eaf2;border-radius:18px;overflow:hidden;box-shadow:0 18px 46px rgba(16,24,40,0.08)">
            <div style="padding:28px 32px 20px;background:linear-gradient(135deg,#eef4ff 0%,#ffffff 58%,#f8fbff 100%)">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
                <tr>
                  <td style="width:56px;vertical-align:middle">${logoHtml}</td>
                  <td style="vertical-align:middle;padding-left:14px">
                    <div style="font-size:20px;font-weight:800;line-height:1.25;color:#0f172a">${BRAND_NAME}</div>
                    <div style="font-size:13px;line-height:1.5;color:#667085">顶级 AI Agent 写作与发布工作台</div>
                  </td>
                </tr>
              </table>
            </div>

            <div style="padding:28px 32px 10px">
              <h1 style="margin:0 0 12px;font-size:26px;line-height:1.35;color:#0f172a">${title}</h1>
              <p style="margin:0;color:#475467;font-size:15px;line-height:1.8">${intro}</p>
            </div>

            <div style="padding:18px 32px 8px">
              <div style="background:#f1f5ff;border:1px solid #dbe7ff;border-radius:16px;padding:24px 16px;text-align:center">
                <div style="margin:0 0 10px;color:#667085;font-size:13px;letter-spacing:0.08em;text-transform:uppercase">Verification Code</div>
                <div style="font-size:40px;font-weight:800;letter-spacing:10px;line-height:1.2;color:#101828">${code}</div>
              </div>
            </div>

            <div style="padding:18px 32px 30px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f8fafc;border-radius:14px">
                <tr>
                  <td style="padding:16px 18px;color:#344054;font-size:14px;line-height:1.75">
                    <strong style="color:#0f172a">安全提示</strong><br />
                    ${securityHint}
                  </td>
                </tr>
              </table>
            </div>
          </div>

          <div style="padding:18px 6px 0;text-align:center;color:#98a2b3;font-size:12px;line-height:1.6">
            本邮件由 ${BRAND_NAME} 安全系统自动发送。请勿直接回复。
          </div>
        </div>
      </div>`,
  };
}

/**
 * 注册验证码邮件模板。
 * 明文 code 仅出现在邮件正文（DB 仅存 codeHash）。
 */
export function renderRegisterCodeEmail(
  to: string,
  code: string,
  expiresInMinutes = 10
): MailMessage {
  return brandEnvelope({
    to,
    code,
    expiresInMinutes,
    subject: `【${BRAND_NAME}】注册验证码 ${code}`,
    title: "确认你的注册验证码",
    intro: `你正在创建 ${BRAND_NAME} 账号。完成注册后，即可体验面向专业创作者的顶级 AI Agent 服务，用于选题策划、资料整理、文字创作、长文写作、风格优化与多渠道发布预览。`,
    securityHint: `验证码 ${expiresInMinutes} 分钟内有效，仅用于本次注册。${BRAND_NAME} 工作人员不会向你索要验证码，请勿转发给任何人。如果这不是你本人发起的操作，请忽略本邮件。`,
  });
}

/**
 * 找回密码验证码邮件模板。
 */
export function renderResetPasswordEmail(
  to: string,
  code: string,
  expiresInMinutes = 10
): MailMessage {
  return brandEnvelope({
    to,
    code,
    expiresInMinutes,
    subject: `【${BRAND_NAME}】找回密码验证码 ${code}`,
    title: "重置你的账号密码",
    intro: `你正在重置 ${BRAND_NAME} 账号密码。请在找回密码页面填入下方验证码并设置新密码。`,
    securityHint: `验证码 ${expiresInMinutes} 分钟内有效，仅用于本次密码重置。${BRAND_NAME} 工作人员不会向你索要验证码，请勿转发给任何人。如果这不是你本人发起的操作，请忽略本邮件，你的密码不会被修改。`,
  });
}
