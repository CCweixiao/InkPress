"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewMode = "grid" | "list";

/** 客户端读缓存 key（仅用于首屏避免闪烁；权威值在 SystemConfig 数据库） */
const VIEW_MODE_STORAGE_KEY = "inkpress.view-mode";

/**
 * SystemConfig 数据库 key（与 src/lib/ui-preferences.ts 保持一致）。
 * 此处仅复制字符串常量，避免把 prisma 引入客户端 bundle
 * （同 appearance-config.ts / theme-mode.ts 的拆分约定）。
 */
const UI_PREFERENCES_KEY = "inkpress.ui-preferences";

/** 列表 / 网格 视图切换（胶囊式，与项目既有 tab 风格一致） */
export function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div className="flex gap-1 rounded-md bg-muted p-1">
      <button
        type="button"
        onClick={() => onChange("grid")}
        className={cn(
          "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors",
          value === "grid"
            ? "bg-background shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
        title="网格视图"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        网格
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        className={cn(
          "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors",
          value === "list"
            ? "bg-background shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
        title="列表视图"
      >
        <List className="h-3.5 w-3.5" />
        列表
      </button>
    </div>
  );
}

/** 读取 localStorage 中的视图偏好缓存；无缓存或不可用时返回 null */
function readStoredViewMode(): ViewMode | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return stored === "list" || stored === "grid" ? stored : null;
  } catch {
    return null;
  }
}

/** 把视图偏好写入 SystemConfig 数据库（落盘到 InkPress 数据目录，按环境隔离） */
function persistUiPreferences(viewMode: ViewMode) {
  fetch("/api/system-config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key: UI_PREFERENCES_KEY,
      value: JSON.stringify({ viewMode }),
    }),
  }).catch(() => undefined);
}

/**
 * 网格/列表视图偏好。
 *
 * 权威存储：SystemConfig 数据库（inkpress.ui-preferences），由 SSR 通过
 * `initialView` 注入首帧值，避免闪烁与水合警告。
 * 客户端缓存：localStorage（inkpress.view-mode），挂载后若存在则以本机最新选择
 * 为准并回填，保证同一浏览器的偏好即时生效。
 *
 * 切换时双写：localStorage（即时）+ 数据库（持久、随数据目录迁移/备份）。
 *
 * @param initialView 服务端从数据库读回的首帧值（默认 grid）。
 */
export function useViewMode(
  initialView: ViewMode = "grid"
): [ViewMode, (next: ViewMode) => void] {
  const [view, setViewState] = useState<ViewMode>(initialView);
  const initialRef = useRef(initialView);

  useEffect(() => {
    const cached = readStoredViewMode();
    const effective = cached ?? initialRef.current;
    if (effective !== initialRef.current) setViewState(effective);
    // 回填客户端缓存，使后续访问可即时读取
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, effective);
    } catch {
      /* localStorage 不可用时静默 */
    }
  }, []);

  const setView = useCallback((next: ViewMode) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch {
      /* localStorage 不可用时静默回退 */
    }
    persistUiPreferences(next);
  }, []);

  return [view, setView] as const;
}
