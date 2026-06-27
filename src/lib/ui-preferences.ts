import { prisma } from "@/lib/db";
import {
  parseJsonObjectOrArrayConfig,
  type JsonObject,
} from "@/lib/system-config";

/**
 * UI 偏好（客户端界面层用户选择，如列表/网格视图）。
 *
 * 与 inkpress.appearance（外观主题）并列、职责不同：
 * - appearance：明暗模式 + 主题色（影响 <html> class，需 SSR 首帧）。
 * - ui-preferences：纯交互层偏好，按需扩展。
 *
 * 落盘到 SystemConfig 表，数据库文件由 src/lib/paths.ts 决定：
 * - 打包/Electron/Docker：~/.inkpress/database/inkpress.db（或 INKPRESS_HOME）
 * - 本地开发：./dev.db（项目根），与生产数据天然隔离。
 */
export const UI_PREFERENCES_KEY = "inkpress.ui-preferences";

/** 视图模式（与客户端 ViewToggle.ViewMode 结构一致） */
export type ViewModePref = "grid" | "list";

export type UiPreferences = {
  viewMode: ViewModePref;
};

/** 默认 UI 偏好（无记录时回退） */
export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  viewMode: "grid",
};

/** 解析 UI 偏好 JSON（非法值回退默认） */
export function parseUiPreferences(value: string): UiPreferences {
  const raw = parseJsonObjectOrArrayConfig(value, "UI 偏好") as JsonObject;
  const viewModeRaw = typeof raw.viewMode === "string" ? raw.viewMode : "grid";
  const viewMode: ViewModePref = viewModeRaw === "list" ? "list" : "grid";
  return { viewMode };
}

/** 读取 UI 偏好（DB 无记录时返回默认值，不抛错） */
export async function getUiPreferences(): Promise<UiPreferences> {
  const item = await prisma.systemConfig.findUnique({
    where: { key: UI_PREFERENCES_KEY },
  });
  if (!item) return DEFAULT_UI_PREFERENCES;
  try {
    return parseUiPreferences(item.value);
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}
