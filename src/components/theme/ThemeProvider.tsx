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

// 外观配置在 SystemConfig 表的 key（与 src/lib/appearance-config 保持一致）。
// 此处内联常量，避免客户端组件间接引入 @prisma（仅服务端可用）。
const APPEARANCE_CONFIG_KEY = "inkpress.appearance";

export type ThemeMode = "light" | "dark" | "auto";

type ThemeContextValue = {
  /** 用户选择：light / dark / auto */
  mode: ThemeMode;
  /** 实际生效：light / dark（auto 时跟随系统） */
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "inkpress.appearance";

function systemPrefersDark() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 读取 localStorage 中的用户偏好（与 layout 注入的阻塞脚本保持一致） */
function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "auto") return raw;
  } catch {
    /* localStorage 不可用时回退 auto */
  }
  return "auto";
}

/**
 * 主题 Provider：管理 light/dark/auto 状态，同步 <html> class、localStorage、服务端配置。
 * 首帧由 layout.tsx 注入的阻塞脚本处理（无 FOUC），Provider 启动后接管。
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

  // 应用主题到 <html>（客户端）
  const applyTheme = useCallback((next: ThemeMode) => {
    if (typeof document === "undefined") return;
    const isDark =
      next === "dark" || (next === "auto" && systemPrefersDark());
    document.documentElement.classList.toggle("dark", isDark);
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

  // 挂载后若 mode 与实际 <html> class 不一致（首帧脚本与 localStorage 不同步），修正一次
  useEffect(() => {
    if (mounted) applyTheme(mode);
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
