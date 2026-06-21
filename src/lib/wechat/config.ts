import { parseJsonObjectOrArrayConfig } from "@/lib/system-config";
import { prisma } from "@/lib/db";

export const WECHAT_CONFIG_KEY = "inkpress.wechat";

const wechatConfigFields = ["appId", "secret"] as const;

export type WechatConfig = Record<(typeof wechatConfigFields)[number], string>;

/** 校验微信配置 JSON：{ appId, secret }（均为必填非空字符串） */
export function parseWechatConfig(value: string): WechatConfig {
  const raw = parseJsonObjectOrArrayConfig(value, "微信配置");
  if (Array.isArray(raw)) throw new Error("微信配置必须是 JSON 对象。");
  const config = raw as Record<string, unknown>;
  const missing = wechatConfigFields.filter(
    (field) => typeof config[field] !== "string" || !(config[field] as string).trim()
  );
  if (missing.length) throw new Error(`微信配置缺少字段：${missing.join(", ")}。`);

  return {
    appId: String(config.appId).trim(),
    secret: String(config.secret).trim(),
  };
}

/** 从 DB 读取微信配置（未配置时抛错） */
export async function getWechatConfig(): Promise<WechatConfig> {
  const item = await prisma.systemConfig.findUnique({
    where: { key: WECHAT_CONFIG_KEY },
  });
  if (!item) throw new Error("尚未配置微信公众号凭证，请先在「设置」中配置。");
  return parseWechatConfig(item.value);
}

/** 微信是否已配置（不抛错，用于状态展示） */
export async function hasWechatConfig(): Promise<boolean> {
  const item = await prisma.systemConfig.findUnique({
    where: { key: WECHAT_CONFIG_KEY },
  });
  if (!item) return false;
  try {
    parseWechatConfig(item.value);
    return true;
  } catch {
    return false;
  }
}
