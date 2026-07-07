import { moduleLogger } from "@/lib/logger";
import { ConsoleMailAdapter } from "./console";
import { SmtpMailAdapter } from "./smtp";
import { ResendMailAdapter } from "./resend";
import type { MailAdapter, MailMessage } from "./types";

export type { MailAdapter, MailMessage } from "./types";
export { renderRegisterCodeEmail, renderResetPasswordEmail } from "./template";
export {
  renderNewTicketAdminEmail,
  renderTicketRepliedUserEmail,
  renderTicketRepliedAdminEmail,
  renderTicketClosedUserEmail,
} from "./templates/ticket-emails";
export type { TicketEmailData, TicketReplyEmailData } from "./templates/ticket-emails";
export { renderOrderPaidReceiptEmail } from "./templates/order-emails";
export type { OrderReceiptData } from "./templates/order-emails";

const log = moduleLogger("mail");

let cached: MailAdapter | null = null;

/**
 * 按 MAIL_PROVIDER 返回适配器单例。
 * - console（默认）：开发，明文写 stdout + ./data/dev-mail.log
 * - smtp：nodemailer，生产
 * - resend：Resend HTTP API，生产
 */
export function getMailAdapter(): MailAdapter {
  if (cached) return cached;
  const provider = (process.env.MAIL_PROVIDER ?? "console").toLowerCase();
  switch (provider) {
    case "smtp":
      cached = new SmtpMailAdapter();
      break;
    case "resend": {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) throw new Error("MAIL_PROVIDER=resend 但未配置 RESEND_API_KEY");
      cached = new ResendMailAdapter(apiKey);
      break;
    }
    case "console":
    default:
      cached = new ConsoleMailAdapter();
      break;
  }
  log.info({ provider }, "邮件适配器已初始化");
  return cached;
}

export async function sendMail(msg: MailMessage): Promise<void> {
  await getMailAdapter().send(msg);
}
