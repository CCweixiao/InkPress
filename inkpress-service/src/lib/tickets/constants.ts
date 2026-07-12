/**
 * 工单系统常量（PDC §工单系统）。
 * 枚举取值集合与 DB 字段注释、Zod schema 保持一致。
 */

export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

/** 管理员通知邮箱（用户创建工单/追问时通知到此邮箱） */
export const TICKET_ADMIN_EMAIL =
  process.env.TICKET_NOTIFY_EMAIL?.trim() || "support@longoflow.com";

/** OSS 签名 URL 有效期（秒） */
export const OSS_SIGN_EXPIRES_SEC = 900;

export const TICKET_TYPE_LABELS: Record<string, string> = {
  PAYMENT: "付款问题",
  LICENSE: "License 激活",
  ACCOUNT: "账号问题",
  USAGE: "工具使用",
  HELP: "使用帮助",
  BUG: "问题反馈",
  FEATURE: "功能建议",
  OTHER: "其他",
};

export const TICKET_STATUS_LABELS: Record<string, string> = {
  OPEN: "待处理",
  ANSWERED: "已回复",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
};

export const TICKET_PRIORITY_LABELS: Record<string, string> = {
  LOW: "低",
  NORMAL: "正常",
  HIGH: "高",
};
