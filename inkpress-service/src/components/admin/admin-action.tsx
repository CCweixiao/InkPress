"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface AdminActionProps {
  label: string;
  href: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  confirmText?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  onSuccess?: () => void;
  refreshAfter?: boolean;
  disabled?: boolean;
}

/**
 * 危险操作统一组件：window.confirm 二次确认 → 调 API → 成功后刷新路由（PDC §8 危险操作二次确认）。
 */
export function AdminAction({
  label,
  href,
  method = "PATCH",
  body,
  confirmText,
  variant = "outline",
  size = "sm",
  onSuccess,
  refreshAfter = true,
  disabled,
}: AdminActionProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function run() {
    if (confirmText && !window.confirm(confirmText)) return;
    setLoading(true);
    try {
      const res = await fetch(href, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        window.alert(data?.error?.message ?? "操作失败");
        return;
      }
      onSuccess?.();
      if (refreshAfter) router.refresh();
    } catch {
      window.alert("网络错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant={variant} size={size} disabled={loading || disabled} onClick={run}>
      {loading ? "处理中…" : label}
    </Button>
  );
}
