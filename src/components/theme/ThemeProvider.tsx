"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  persistThemeModeCookie,
  parseThemeMode,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "@/lib/theme-mode";

// 外观配置在 SystemConfig 表的 key（与 src/lib/appearance-config 保持一致）。
const APPEARANCE_CONFIG_KEY = "inkpress.appearance";

export type { ThemeMode };

type ThemeContextValue = {
  /** 用户选择：light / dark / auto */
  mode: ThemeMode;
  /** 实际生效：light / dark（auto 时跟随系统） */
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = THEME_STORAGE_KEY;

function systemPrefersDark() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 读取 localStorage 中的用户偏好（与 layout 注入的阻塞脚本保持一致） */
function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  try {
    return parseThemeMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    /* localStorage 不可用时回退 auto */
  }
  return "auto";
}

/**
 * 主题 Provider：管理 light/dark/auto 状态，同步 <html> class、localStorage、cookie、服务端配置。
 * 首帧由 layout SSR 读 cookie + CSS prefers-color-scheme 处理（无阻塞 script）。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("auto");
  const [mounted, setMounted] = useState(false);

  // 首次挂载：从 localStorage 读回用户偏好
  useEffect(() => {
    setModeState(readStoredMode());
    setMounted(true);
  }, []);

  // auto 模式下监听系统主题变化
  useEffect(() => {
    if (mode !== "auto" || typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(mode);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const resolved: "light" | "dark" = useMemo(() => {
    if (mode === "auto") return systemPrefersDark() ? "dark" : "light";
    return mode;
  }, [mode]);

  // 应用主题到 <html>（客户端）：显式 dark/light 写 class；auto 移除二者交给 CSS 媒体查询。
  const applyTheme = useCallback((next: ThemeMode) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    if (next === "dark") root.classList.add("dark");
    else if (next === "light") root.classList.add("light");
  }, []);

  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      applyTheme(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* 忽略写入失败 */
      }
      persistThemeModeCookie(next);
      // 同步到服务端（复用 /api/system-config，跨设备保持一致）
      fetch("/api/system-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: APPEARANCE_CONFIG_KEY,
          value: JSON.stringify({ mode: next, primaryColor: "#3f51b5" }),
        }),
      }).catch(() => undefined);
    },
    [applyTheme]
  );

  // light ↔ dark 快速切换（auto 视当前 resolved 决定切到哪边）
  const toggle = useCallback(() => {
    setMode(resolved === "dark" ? "light" : "dark");
  }, [resolved, setMode]);

  // 挂载后若 localStorage 与 <html> class 不一致（首帧 cookie/系统偏好），修正一次并回写 cookie。
  useEffect(() => {
    if (!mounted) return;
    applyTheme(mode);
    persistThemeModeCookie(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  const value = useMemo(
    () => ({ mode, resolved, setMode, toggle }),
    [mode, resolved, setMode, toggle]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // 未被 Provider 包裹时的安全回退（不应发生）
    return {
      mode: "auto",
      resolved: "light",
      setMode: () => undefined,
      toggle: () => undefined,
    };
  }
  return ctx;
}
