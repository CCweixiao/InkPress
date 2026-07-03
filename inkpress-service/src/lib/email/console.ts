import fs from "node:fs";
import path from "node:path";
import type { MailAdapter, MailMessage } from "./types";

/**
 * 开发用 console/file 适配器。
 *
 * 明文验证码会输出到 stdout 并追加到 ./data/dev-mail.log，便于本地联调。
 * 仅当 MAIL_PROVIDER=console（默认）时启用；生产应使用 smtp/resend，明文不落日志。
 */
export class ConsoleMailAdapter implements MailAdapter {
  private readonly logFile: string;

  constructor() {
    const dir = path.join(process.cwd(), "data");
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* 忽略：目录已存在或无权限，退化为仅 stdout */
    }
    this.logFile = path.join(dir, "dev-mail.log");
  }

  async send(msg: MailMessage): Promise<void> {
    const block = [
      "===== DEV MAIL =====",
      `To:      ${msg.to}`,
      `Subject: ${msg.subject}`,
      `Text:    ${msg.text ?? ""}`,
      "====================",
    ].join("\n");
    // 直接 stdout，绕过 pino redact（开发专用，刻意展示明文验证码）
    console.log(`\n${block}\n`);
    try {
      fs.appendFileSync(this.logFile, `${new Date().toISOString()}\n${block}\n\n`);
    } catch {
      /* 忽略写入失败 */
    }
  }
}
