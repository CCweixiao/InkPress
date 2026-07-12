import type { MailMessage } from "../types";
import { TICKET_TYPE_LABELS, TICKET_STATUS_LABELS } from "@/lib/tickets/constants";

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

/** HTML 转义，防 XSS */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeMulti(s: string): string {
  return escapeHtml(s).replace(/\n/g, "<br />");
}

const LOGO_PATH = "/inkpress-logo.png";

function logoHtml(): string {
  const logoUrl = publicUrl(LOGO_PATH);
  return logoUrl
    ? `<img src="${logoUrl}" width="48" height="48" alt="InkPress" style="display:block;width:48px;height:48px;border-radius:12px" />`
    : `<div style="width:48px;height:48px;border-radius:12px;background:#2563eb;color:#ffffff;font-size:22px;font-weight:800;line-height:48px;text-align:center">IP</div>`;
}

/** 通用品牌外壳（工单通知专用，不含验证码块） */
function ticketEnvelope(opts: {
  to: string;
  subject: string;
  title: string;
  bodyHtml: string;
  buttonText: string;
  buttonHref: string;
}): MailMessage {
  const { to, subject, title, bodyHtml, buttonText, buttonHref } = opts;
  const link = publicUrl(buttonHref) ?? "#";
  return {
    to,
    subject,
    text: `${title}\n${buttonText}: ${link}`,
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
                    <div style="font-size:13px;line-height:1.5;color:#667085">工单支持中心</div>
                  </td>
                </tr>
              </table>
            </div>
            <div style="padding:28px 32px 10px">
              <h1 style="margin:0 0 16px;font-size:24px;line-height:1.35;color:#0f172a">${escapeHtml(title)}</h1>
              ${bodyHtml}
            </div>
            <div style="padding:8px 32px 30px;text-align:center">
              <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px">${escapeHtml(buttonText)}</a>
            </div>
          </div>
          <div style="padding:18px 6px 0;text-align:center;color:#98a2b3;font-size:12px;line-height:1.6">
            本邮件由 ${BRAND_NAME} 系统自动发送。请勿直接回复。
          </div>
        </div>
      </div>`,
  };
}

export interface TicketEmailData {
  id: string;
  type: string;
  subject: string;
  description?: string;
  status?: string;
}

export interface TicketReplyEmailData {
  content: string;
  authorRole: string;
  createdAt: Date;
}

/** 用户创建工单 → 通知管理员 */
export function renderNewTicketAdminEmail(
  ticket: TicketEmailData,
  userEmail: string
): MailMessage {
  const typeLabel = TICKET_TYPE_LABELS[ticket.type] ?? ticket.type;
  const descPreview = (ticket.description ?? "").slice(0, 200);
  return ticketEnvelope({
    to: process.env.TICKET_NOTIFY_EMAIL?.trim() || "support@longoflow.com",
    subject: `【${BRAND_NAME}】新工单 #${ticket.id.slice(-8)} ${ticket.subject}`,
    title: "收到新的支持工单",
    bodyHtml: `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px;line-height:1.75;color:#344054">
        <tr><td style="padding:4px 0;color:#667085;width:80px">工单号</td><td style="padding:4px 0;color:#0f172a;font-weight:600">#${escapeHtml(ticket.id.slice(-8))}</td></tr>
        <tr><td style="padding:4px 0;color:#667085">类型</td><td style="padding:4px 0;color:#0f172a">${escapeHtml(typeLabel)}</td></tr>
        <tr><td style="padding:4px 0;color:#667085">用户</td><td style="padding:4px 0;color:#0f172a">${escapeHtml(userEmail)}</td></tr>
        <tr><td style="padding:4px 0;color:#667085">标题</td><td style="padding:4px 0;color:#0f172a">${escapeHtml(ticket.subject)}</td></tr>
      </table>
      <div style="margin:16px 0 0;padding:16px 18px;background:#f8fafc;border-radius:12px;font-size:14px;line-height:1.75;color:#344054">${escapeMulti(descPreview)}${(ticket.description ?? "").length > 200 ? "…" : ""}</div>
    `,
    buttonText: "前往管理后台处理",
    buttonHref: `/admin/tickets/${ticket.id}`,
  });
}

/** 管理员回复 → 通知用户 */
export function renderTicketRepliedUserEmail(
  to: string,
  ticket: TicketEmailData,
  reply: TicketReplyEmailData
): MailMessage {
  return ticketEnvelope({
    to,
    subject: `【${BRAND_NAME}】工单 #${ticket.id.slice(-8)} 有新回复`,
    title: "你的工单有新回复",
    bodyHtml: `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px;line-height:1.75;color:#344054">
        <tr><td style="padding:4px 0;color:#667085;width:80px">工单号</td><td style="padding:4px 0;color:#0f172a;font-weight:600">#${escapeHtml(ticket.id.slice(-8))}</td></tr>
        <tr><td style="padding:4px 0;color:#667085">标题</td><td style="padding:4px 0;color:#0f172a">${escapeHtml(ticket.subject)}</td></tr>
      </table>
      <div style="margin:16px 0 0;padding:16px 18px;background:#f8fafc;border-radius:12px;font-size:14px;line-height:1.75;color:#344054">${escapeMulti(reply.content)}</div>
    `,
    buttonText: "查看并回复",
    buttonHref: `/dashboard/tickets/${ticket.id}`,
  });
}

/** 用户追问 → 通知管理员 */
export function renderTicketRepliedAdminEmail(
  ticket: TicketEmailData,
  reply: TicketReplyEmailData,
  userEmail: string
): MailMessage {
  return ticketEnvelope({
    to: process.env.TICKET_NOTIFY_EMAIL?.trim() || "support@longoflow.com",
    subject: `【${BRAND_NAME}】工单 #${ticket.id.slice(-8)} 用户追问`,
    title: "用户在工单中追问了新内容",
    bodyHtml: `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px;line-height:1.75;color:#344054">
        <tr><td style="padding:4px 0;color:#667085;width:80px">工单号</td><td style="padding:4px 0;color:#0f172a;font-weight:600">#${escapeHtml(ticket.id.slice(-8))}</td></tr>
        <tr><td style="padding:4px 0;color:#667085">用户</td><td style="padding:4px 0;color:#0f172a">${escapeHtml(userEmail)}</td></tr>
        <tr><td style="padding:4px 0;color:#667085">标题</td><td style="padding:4px 0;color:#0f172a">${escapeHtml(ticket.subject)}</td></tr>
      </table>
      <div style="margin:16px 0 0;padding:16px 18px;background:#f8fafc;border-radius:12px;font-size:14px;line-height:1.75;color:#344054">${escapeMulti(reply.content)}</div>
    `,
    buttonText: "前往管理后台处理",
    buttonHref: `/admin/tickets/${ticket.id}`,
  });
}

/** 管理员关闭/解决 → 通知用户 */
export function renderTicketClosedUserEmail(
  to: string,
  ticket: TicketEmailData
): MailMessage {
  const statusLabel = TICKET_STATUS_LABELS[ticket.status ?? ""] ?? ticket.status;
  return ticketEnvelope({
    to,
    subject: `【${BRAND_NAME}】工单 #${ticket.id.slice(-8)} 已${statusLabel}`,
    title: `你的工单已${statusLabel}`,
    bodyHtml: `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px;line-height:1.75;color:#344054">
        <tr><td style="padding:4px 0;color:#667085;width:80px">工单号</td><td style="padding:4px 0;color:#0f172a;font-weight:600">#${escapeHtml(ticket.id.slice(-8))}</td></tr>
        <tr><td style="padding:4px 0;color:#667085">标题</td><td style="padding:4px 0;color:#0f172a">${escapeHtml(ticket.subject)}</td></tr>
        <tr><td style="padding:4px 0;color:#667085">状态</td><td style="padding:4px 0;color:#0f172a">${escapeHtml(statusLabel)}</td></tr>
      </table>
      <p style="margin:16px 0 0;color:#475467;font-size:14px;line-height:1.75">如果问题仍未解决，你可以在工单详情页继续回复以重新打开工单。</p>
    `,
    buttonText: "查看工单",
    buttonHref: `/dashboard/tickets/${ticket.id}`,
  });
}
