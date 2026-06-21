import { prisma } from "@/lib/db";
import {
  parseJsonObjectOrArrayConfig,
  type JsonObject,
} from "@/lib/system-config";

export const I18N_CONFIG_KEY = "inkpress.i18n";

/** 支持的语言 */
export type Locale = "zh-CN" | "en-US";

export type I18nConfig = {
  locale: Locale;
};

/** 默认语言（也作为 data.sql 预设值） */
export const DEFAULT_I18N: I18nConfig = { locale: "zh-CN" };

/** 解析国际化配置 JSON */
export function parseI18nConfig(value: string): I18nConfig {
  const raw = parseJsonObjectOrArrayConfig(value, "国际化配置") as JsonObject;
  const localeRaw = typeof raw.locale === "string" ? raw.locale : "zh-CN";
  const locale: Locale = localeRaw === "en-US" ? "en-US" : "zh-CN";
  return { locale };
}

/** 读取国际化配置（DB 无记录时返回默认值，不抛错） */
export async function getI18nConfig(): Promise<I18nConfig> {
  const item = await prisma.systemConfig.findUnique({
    where: { key: I18N_CONFIG_KEY },
  });
  if (!item) return DEFAULT_I18N;
  try {
    return parseI18nConfig(item.value);
  } catch {
    return DEFAULT_I18N;
  }
}
