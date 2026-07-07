import nodemailer from "nodemailer";
import { moduleLogger } from "@/lib/logger";
import type { MailAdapter, MailMessage } from "./types";

const log = moduleLogger("mail:smtp");

/** SMTP 适配器（nodemailer）。MAIL_PROVIDER=smtp 时启用。 */
export class SmtpMailAdapter implements MailAdapter {
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor() {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const host = process.env.SMTP_HOST;
    this.from = process.env.MAIL_FROM ?? "";
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined,
    });

    // 启动期连接校验：失败仅记日志，不阻断服务（邮件可稍后由用户重发）。
    this.transporter
      .verify()
      .then(() => log.info({ host, port }, "SMTP 连接校验通过"))
      .catch((err) =>
        log.error({ host, port, err }, "SMTP 连接校验失败——邮件发送可能不可用")
      );
  }

  async send(msg: MailMessage): Promise<void> {
    if (!this.from) {
      throw new Error("SMTP 发件失败：未配置 MAIL_FROM");
    }
    const info = await this.transporter.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    log.info({ to: msg.to, messageId: info.messageId }, "邮件已发送");
  }
}
