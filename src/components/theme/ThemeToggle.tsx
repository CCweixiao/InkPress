"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme, type ThemeMode } from "./ThemeProvider";

const ORDER: ThemeMode[] = ["light", "dark", "auto"];
const LABEL: Record<ThemeMode, string> = {
  light: "日间模式",
  dark: "夜间模式",
  auto: "跟随系统",
};

/**
 * 日/夜模式切换按钮。
 * 点击在三态间循环：light → dark → auto → light。
 * 图标随当前模式变化，保持导航栏视觉一致。
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { mode, resolved, setMode } = useTheme();
  // 首帧用 resolved 占位，挂载后显示真实 mode（避免 SSR/CSR 图标不一致闪烁）
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const display = mounted ? mode : resolved;
  const Icon = display === "dark" ? Moon : display === "auto" ? Monitor : Sun;

  function cycle() {
    const idx = ORDER.indexOf(mode);
    setMode(ORDER[(idx + 1) % ORDER.length]);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8", className)}
      title={LABEL[mode]}
      aria-label={LABEL[mode]}
      onClick={cycle}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
