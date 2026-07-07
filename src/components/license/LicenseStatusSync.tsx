"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type LicenseStatus = {
  required: boolean;
  allowed: boolean;
  mode:
    | "active"
    | "offline-grace"
    | "inactive"
    | "invalid"
    | "not-required"
    | "trial"
    | "trial-expired";
  defaultServiceBaseUrl?: string;
  message?: string;
  state: null | {
    serviceBaseUrl: string;
    licenseFingerprint: string;
    status: string;
    effectiveExpiresAt: string | null;
    activatedAt?: string;
    maxDevices: number;
    activatedDevices?: number;
    lastValidatedAt: string;
    offlineGraceExpiresAt: string;
  };
  trial?: {
    trialExpiresAt: string;
    remainingMs: number;
  };
};

type LicenseStatusSyncContextValue = {
  status: LicenseStatus | null;
  refresh: () => Promise<void>;
  /** 是否应展示全屏拦截弹窗。 */
  shouldShowGate: boolean;
};

const LicenseStatusSyncContext = createContext<LicenseStatusSyncContextValue>({
  status: null,
  refresh: async () => {},
  shouldShowGate: false,
});

const POLL_INTERVAL_MS = 60 * 1000; // 60 秒轮询

export function LicenseStatusSyncProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/license/status", { cache: "no-store" });
      const data = (await res.json()) as LicenseStatus;
      setStatus(data);
    } catch {
      // 网络错误不覆盖已有状态（离线时保持上次结果）
    }
  }, []);

  useEffect(() => {
    void refresh();

    // 定时轮询
    timerRef.current = setInterval(() => void refresh(), POLL_INTERVAL_MS);

    // 窗口 focus 时刷新
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // 仅在 trial-expired / invalid 模式下展示拦截弹窗
  const shouldShowGate =
    status?.required === true &&
    status.allowed === false &&
    (status.mode === "trial-expired" || status.mode === "invalid");

  return (
    <LicenseStatusSyncContext.Provider value={{ status, refresh, shouldShowGate }}>
      {children}
    </LicenseStatusSyncContext.Provider>
  );
}

export function useLicenseStatus() {
  return useContext(LicenseStatusSyncContext);
}

/** 购买链接策略：生产=longoflow.com；开发额外显示 localhost:3001。 */
export function getPurchaseLinks(): { primary: string; dev?: string } {
  const isProd = process.env.NODE_ENV === "production";
  const primary = "https://www.longoflow.com";
  if (isProd) return { primary };
  return { primary, dev: "http://localhost:3001" };
}
