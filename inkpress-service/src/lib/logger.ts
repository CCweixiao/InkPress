import pino from "pino";

/**
 * 统一结构化日志（pino）。
 *
 * - 生产：JSON 行 → stdout（容器友好，由 Docker 日志驱动收集）
 * - 开发：pino-pretty 美化控制台
 *
 * redact：敏感字段在序列化时以 "***" 替换，避免密码哈希 / 密钥 / token 落日志。
 * 级别由 LOG_LEVEL 控制，默认 info。
 *
 * 注：曾把 `code` / `*.code` 列入掩码，但误伤了支付宝 result.code、
 * AppError.code 等业务错误码，导致排查困难。验证码本身从不上日志
 * （email-code-service.ts 只记 email+purpose），故移除该规则。
 */

const isDev = process.env.NODE_ENV !== "production";

const REDACT_PATHS = [
  "password",
  "passwordHash",
  "newPassword",
  "oldPassword",
  "codeHash",
  "activationSecret",
  // Phase 4 补充：License / 密钥 / 凭据相关（PDC §9.2）
  "licenseKey",
  "licenseToken",
  "secret",
  "apiKey",
  "pass",
  "activationSecretEnc",
  "activationSecretHash",
  "keyHash",
  "privateKey",
  "kek",
  "*.password",
  "*.passwordHash",
  "*.newPassword",
  "*.oldPassword",
  "*.codeHash",
  "*.activationSecret",
  "*.licenseKey",
  "*.licenseToken",
  "*.secret",
  "*.apiKey",
  "*.pass",
  "*.activationSecretEnc",
  "*.activationSecretHash",
  "*.keyHash",
  "*.privateKey",
  "*.kek",
  "*.access_token",
  "*.refresh_token",
  "*.id_token",
  "req.headers.authorization",
  "req.headers.cookie",
];

export const logger = isDev
  ? pino({
      level: process.env.LOG_LEVEL ?? "info",
      redact: { paths: REDACT_PATHS, censor: "***" },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l" },
      },
    })
  : pino({
      level: process.env.LOG_LEVEL ?? "info",
      redact: { paths: REDACT_PATHS, censor: "***" },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
    });

/** 创建带 module 标签的子日志 */
export function moduleLogger(module: string) {
  return logger.child({ module });
}
