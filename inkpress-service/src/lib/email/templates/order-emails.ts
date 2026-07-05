import type { MailMessage } from "../types";

const BRAND_NAME = "InkPress";

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const LOGO_PATH = "/inkpress-logo.png";

function logoHtml(): string {
  const logoUrl = publicUrl(LOGO_PATH);
  return logoUrl
    ? `<img src="${logoUrl}" width="48" height="48" alt="InkPress" style="display:block;width:48px;height:48px;border-radius:12px" />`
    : `<div style="width:48px;height:48px;border-radius:12px;background:#2563eb;color:#ffffff;font-size:22px;font-weight:800;line-height:48px;text-align:center">IP</div>`;
}

export interface OrderReceiptData {
  orderId: string;
  outTradeNo: string;
  planName: string;
  amountCents: number;
  paidAt: Date;
  tradeNo: string;
  /** License 短指纹（displayKeySuffix），不含明文 Key */
  keyFingerprint: string;
  keySuffix: string;
}

/**
 * 支付成功收据邮件。
 * 仅含 License 指纹与后缀，不含明文 Key（避免邮箱泄露即 Key 泄露）。
 * 用户点击按钮跳转 Dashboard 走 reveal-key 流程查看完整 Key。
 */
export function renderOrderPaidReceiptEmail(
  to: string,
  data: OrderReceiptData
): MailMessage {
  const subject = `【${BRAND_NAME}】支付成功收据 · ${data.planName}`;
  const dashboardHref = "/dashboard/licenses";
  const link = publicUrl(dashboardHref) ?? "#";

  const rows: Array<[string, string]> = [
    ["订单号", escapeHtml(data.outTradeNo)],
    ["商品", escapeHtml(data.planName)],
    ["实付金额", `¥${formatYuan(data.amountCents)}`],
    ["支付时间", escapeHtml(formatDate(data.paidAt))],
    ["支付宝流水", escapeHtml(data.tradeNo)],
    ["License 指纹", escapeHtml(data.keyFingerprint)],
    ["License 后缀", `…${escapeHtml(data.keySuffix)}`],
  ];

  return {
    to,
    subject,
    text: [
      `支付成功 · ${data.planName}`,
      ...rows.map(([k, v]) => `${k}: ${v}`),
      `查看 License：${link}`,
      "",
      `本邮件由 ${BRAND_NAME} 系统自动发送，请勿直接回复。`,
    ].join("\n"),
    html: `
      <div style="margin:0;padding:28px 12px;background:#f6f8fb">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#101828">
          <div style="background:#ffffff;border:1px solid #e6eaf2;border-radius:18px;overflow:hidden;box-shadow:0 18px 46px rgba(16,24,40,0.08)">
            <div style="padding:28px 32px 20px;background:linear-gradient(135deg,#eef4ff 0%,#ffffff 58%,#f8fbff 100%)">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
                <tr>
                  <td style="width:56px;vertical-align:middle">${logoHtml()}</td>
                  <td style="vertical-align:middle;padding-left:14px">
                    <div style="font-size:20px;font-weight:800;line-height:1.25;color:#0f172a">${BRAND_NAME}</div>
                    <div style="font-size:13px;line-height:1.5;color:#667085">订单中心</div>
                  </td>
                </tr>
              </table>
            </div>
            <div style="padding:28px 32px 10px">
              <h1 style="margin:0 0 8px;font-size:24px;line-height:1.35;color:#0f172a">支付成功</h1>
              <p style="margin:0 0 18px;color:#475467;font-size:14px;line-height:1.75">你的订单已支付完成，License 已发放到你的账号。请前往 ${BRAND_NAME} 控制台查看完整 License Key 并完成激活。</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px;line-height:1.75;color:#344054;background:#f8fafc;border-radius:14px">
                ${rows
                  .map(
                    ([k, v]) =>
                      `<tr><td style="padding:8px 18px;color:#667085;width:110px">${k}</td><td style="padding:8px 18px;color:#0f172a;font-weight:600">${v}</td></tr>`
                  )
                  .join("")}
              </table>
              <p style="margin:18px 0 0;color:#667085;font-size:12px;line-height:1.75">为保护账号安全，本邮件不含完整 License Key 明文。请登录后到 License 管理页查看。</p>
            </div>
            <div style="padding:8px 32px 30px;text-align:center">
              <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px">查看我的 License</a>
            </div>
          </div>
          <div style="padding:18px 6px 0;text-align:center;color:#98a2b3;font-size:12px;line-height:1.6">
            本邮件由 ${BRAND_NAME} 系统自动发送。请勿直接回复。
          </div>
        </div>
      </div>`,
  };
}
