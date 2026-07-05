"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 桌面客户端「发现新版本」提示横幅。
 *
 * 设计：
 * - 挂载到 root layout 后，启动时和每 6h 检查一次 /api/update-check
 * - 检查结果 + 上次检查时间持久化到 localStorage（缓存命中时秒级展示，无网也无感）
 * - 已忽略版本号 === 最新版本时不弹窗；新版本发布后会再次提示
 * - 右下角浮动卡片，可手动关闭，关闭即「下次再说」
 * - 任意错误（网络/解析）静默跳过，绝不打扰用户
 */

const LS_LAST_CHECKED = "inkpress.update-check.last-checked";
const LS_LATEST_VERSION = "inkpress.update-check.latest-version";
const LS_IGNORED_VERSION = "inkpress.update-check.ignored-version";
const LS_PAYLOAD = "inkpress.update-check.payload";

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 小时
const RECHECK_INTERVAL_DEV_MS = 10 * 1000; // 开发态 10 秒（便于联调）

type UpdatePayload = {
  hasUpdate: boolean;
  latestVersion: string | null;
  currentVersion: string;
  releasedAt?: string;
  changelogMarkdown?: string | null;
  highlights?: string[];
  downloadPageUrl?: string;
  fileName?: string;
  fileSizeBytes?: number;
};

type VisibleState =
  | { kind: "hidden" }
  | { kind: "visible"; payload: UpdatePayload; downloadPageUrl: string };

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 隐私模式或配额满：忽略
  }
}

export function UpdateNotification() {
  const [state, setState] = useState<VisibleState>({ kind: "hidden" });
  const [mounted, setMounted] = useState(false);

  const doCheck = useCallback(async (force: boolean): Promise<void> => {
    const now = Date.now();
    const lastCheckedStr = readLS(LS_LAST_CHECKED);
    const lastChecked = lastCheckedStr ? Number(lastCheckedStr) : 0;
    const isDev = process.env.NODE_ENV !== "production";
    const interval = isDev ? RECHECK_INTERVAL_DEV_MS : RECHECK_INTERVAL_MS;

    // 缓存命中先尝试即时展示（秒级 UX，无需等网络）
    if (!force) {
      const cachedPayload = readLS(LS_PAYLOAD);
      const ignored = readLS(LS_IGNORED_VERSION);
      if (cachedPayload) {
        try {
          const parsed = JSON.parse(cachedPayload) as UpdatePayload;
          if (
            parsed.hasUpdate &&
            parsed.latestVersion &&
            parsed.latestVersion !== ignored
          ) {
            setState({ kind: "visible", payload: parsed, downloadPageUrl: "" });
          }
        } catch {
          // 损坏的缓存：忽略
        }
      }

      // 未到重检窗口：不再发请求
      if (now - lastChecked < interval) return;
    }

    // 发请求
    try {
      const res = await fetch("/api/update-check", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as UpdatePayload & {
        downloadPageUrl?: string;
      };

      writeLS(LS_LAST_CHECKED, String(now));
      if (data.latestVersion) {
        writeLS(LS_LATEST_VERSION, data.latestVersion);
      }
      writeLS(LS_PAYLOAD, JSON.stringify(data));

      const ignored = readLS(LS_IGNORED_VERSION);
      if (
        data.hasUpdate &&
        data.latestVersion &&
        data.latestVersion !== ignored
      ) {
        setState({
          kind: "visible",
          payload: data,
          downloadPageUrl: data.downloadPageUrl ?? "",
        });
      } else {
        setState({ kind: "hidden" });
      }
    } catch {
      // 静默
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    void doCheck(false);

    // 每 6h 重检一次（页面长开场景）
    const timer = setInterval(() => {
      void doCheck(false);
    }, RECHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [doCheck]);

  const onDismiss = useCallback(() => {
    if (state.kind !== "visible") return;
    writeLS(LS_IGNORED_VERSION, state.payload.latestVersion ?? "");
    setState({ kind: "hidden" });
  }, [state]);

  const onOpenDownloadPage = useCallback(() => {
    if (state.kind !== "visible") return;
    const url = state.downloadPageUrl || state.payload.downloadPageUrl;
    if (!url) return;
    // Electron 的 setWindowOpenHandler 会接管，转 shell.openExternal 在系统浏览器打开
    window.open(url, "_blank", "noopener,noreferrer");
    // 不立即关闭：用户回来后可能还想点一次，关闭由 dismiss 显式触发
  }, [state]);

  if (!mounted || state.kind !== "visible") return null;

  const { payload } = state;
  const sizeLabel =
    payload.fileSizeBytes != null
      ? `${(payload.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`
      : null;
  const dateLabel = payload.releasedAt
    ? new Date(payload.releasedAt).toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-4 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)]",
        "rounded-lg border border-border bg-card shadow-lg",
        "animate-in fade-in slide-in-from-bottom-2 duration-300"
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="inline-block h-2 w-2 rounded-full bg-emerald-500 shrink-0"
              aria-hidden
            />
            <p className="text-sm font-medium text-foreground truncate">
              发现新版本 v{payload.latestVersion}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            当前 v{payload.currentVersion}
            {dateLabel ? ` · 发布于 ${dateLabel}` : null}
            {sizeLabel ? ` · ${sizeLabel}` : null}
          </p>
          {payload.highlights && payload.highlights.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground line-clamp-3">
              {payload.highlights.slice(0, 3).map((h, i) => (
                <li key={i} className="truncate">
                  · {h}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="flex items-center justify-end gap-2 px-4 pb-3">
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          下次再说
        </Button>
        <Button size="sm" onClick={onOpenDownloadPage}>
          前往下载
        </Button>
      </div>
    </div>
  );
}
