import { moduleLogger } from "@/lib/logger";
import type { MailAdapter, MailMessage } from "./types";

const log = moduleLogger("mail:resend");

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Resend 适配器（直接 fetch，避免引入额外 SDK 运行时依赖）。 */
export class ResendMailAdapter implements MailAdapter {
  private readonly from: string;
  private readonly timeoutMs: number;

  constructor(private readonly apiKey: string) {
    this.from = process.env.MAIL_FROM ?? "";
    this.timeoutMs = (Number(process.env.MAIL_TIMEOUT_SEC) || 10) * 1000;
  }

  async send(msg: MailMessage): Promise<void> {
    if (!this.from) {
      throw new Error("Resend 发件失败：未配置 MAIL_FROM");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`Resend 发送超时（${this.timeoutMs}ms）`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`resend 发送失败 ${res.status}: ${body}`);
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    log.info({ to: msg.to, id: data.id }, "邮件已发送");
  }
}
