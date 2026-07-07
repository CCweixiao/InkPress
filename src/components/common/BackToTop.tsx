"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

/** 出现阈值：页面滚动超过此像素值后显示按钮 */
const SHOW_THRESHOLD = 300;

/**
 * 右下角「回到顶部」按钮。
 * 监听 window 滚动，超过阈值时淡入显示，点击平滑滚回顶部。
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_THRESHOLD);
    // 初始判定（某些浏览器刷新后仍保留滚动位置）
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="回到顶部"
      title="回到顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={cn(
        "fixed bottom-6 right-6 z-30",
        "h-10 w-10 rounded-full shadow-lg",
        "flex items-center justify-center",
        "bg-primary text-primary-foreground hover:bg-primary/90",
        "border border-border transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        visible
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-2 pointer-events-none"
      )}
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
