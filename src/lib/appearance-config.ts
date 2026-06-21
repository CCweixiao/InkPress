import { prisma } from "@/lib/db";
import {
  parseJsonObjectOrArrayConfig,
  type JsonObject,
} from "@/lib/system-config";

export const APPEARANCE_CONFIG_KEY = "inkpress.appearance";

/** 外观模式：auto 跟随系统，light/dark 强制 */
export type AppearanceMode = "auto" | "light" | "dark";

export type AppearanceConfig = {
  mode: AppearanceMode;
  primaryColor: string;
};

/** 默认外观（也作为 data.sql 预设值） */
export const DEFAULT_APPEARANCE: AppearanceConfig = {
  mode: "auto",
  primaryColor: "#3f51b5",
};

/** 解析外观配置 JSON */
export function parseAppearanceConfig(value: string): AppearanceConfig {
  const raw = parseJsonObjectOrArrayConfig(value, "外观配置") as JsonObject;
  const modeRaw = typeof raw.mode === "string" ? raw.mode : "auto";
  const mode: AppearanceMode =
    modeRaw === "light" || modeRaw === "dark" ? modeRaw : "auto";
  const primaryColor =
    typeof raw.primaryColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(raw.primaryColor)
      ? raw.primaryColor
      : DEFAULT_APPEARANCE.primaryColor;
  return { mode, primaryColor };
}

/** 读取外观配置（DB 无记录时返回默认值，不抛错） */
export async function getAppearanceConfig(): Promise<AppearanceConfig> {
  const item = await prisma.systemConfig.findUnique({
    where: { key: APPEARANCE_CONFIG_KEY },
  });
  if (!item) return DEFAULT_APPEARANCE;
  try {
    return parseAppearanceConfig(item.value);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}
