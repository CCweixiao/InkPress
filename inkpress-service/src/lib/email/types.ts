export interface MailMessage {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

/** 邮件适配器接口（PDC §1：pluggable，开发 console/file，生产 smtp/resend/ses） */
export interface MailAdapter {
  /** 发送邮件；失败抛错，由调用方决定是否重试/记录 */
  send(msg: MailMessage): Promise<void>;
}
