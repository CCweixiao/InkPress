"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * 成功页 License Key 展示（与 Dashboard RevealKeySection 同模式）。
 *
 * 复用 POST /api/me/owned-licenses/:id/reveal-key（后端校验 ownerEmail === 当前邮箱）。
 * 默认只显示「查看 Key」按钮，点击后展示明文 + 复制 + 隐藏。
 */
export function SuccessRevealKey({ licenseId }: { licenseId: string }) {
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function reveal() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/me/owned-licenses/${licenseId}/reveal-key`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "查看失败");
        return;
      }
      setPlaintext(data.data.licenseKey as string);
      setRevealed(true);
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }

  if (revealed && plaintext) {
    return (
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">License Key（明文）</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded-md border border-amber-500/40 bg-amber-50 px-2 py-1.5 font-mono text-sm dark:bg-amber-950/20">
            {plaintext}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!plaintext) return;
              try {
                await navigator.clipboard.writeText(plaintext);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                setError("复制失败，请手动选择");
              }
            }}
          >
            {copied ? "已复制" : "复制"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRevealed(false)}
          >
            隐藏
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={reveal}
        disabled={loading}
      >
        {loading ? "加载中…" : "查看完整 Key"}
      </Button>
      {error && <span className="text-destructive text-sm">{error}</span>}
    </div>
  );
}
