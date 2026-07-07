/** 与 ThemeProvider / layout cookie 共用的外观模式 key。 */
export const THEME_STORAGE_KEY = "inkpress.appearance";

export type ThemeMode = "light" | "dark" | "auto";

export function parseThemeMode(raw: string | undefined | null): ThemeMode {
  if (raw === "light" || raw === "dark" || raw === "auto") return raw;
  return "auto";
}

/** SSR 首帧：显式 light/dark 写到 <html>；auto 不加类，由 CSS prefers-color-scheme 接管。 */
export function themeModeToHtmlClass(mode: ThemeMode): "dark" | "light" | undefined {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return undefined;
}

/** 客户端同步 cookie，供下次 SSR 首帧无闪烁。 */
export function persistThemeModeCookie(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.cookie = `${THEME_STORAGE_KEY}=${mode};path=/;max-age=31536000;SameSite=Lax`;
}
