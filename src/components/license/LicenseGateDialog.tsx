"use client";

import { useEffect, useState } from "react";
import { ExternalLink, KeyRound, RefreshCw, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPurchaseLinks, useLicenseStatus } from "@/components/license/LicenseStatusSync";

/** 全屏遮罩激活弹窗：trial-expired / invalid 时弹出。 */
export function LicenseGateDialog() {
  const { status, refresh, shouldShowGate } = useLicenseStatus();
  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const purchaseLinks = getPurchaseLinks();

  // 弹窗关闭时清空错误
  useEffect(() => {
    if (!shouldShowGate) setError(null);
  }, [shouldShowGate]);

  const mode = status?.mode;
  const title =
    mode === "trial-expired"
      ? "7 天免费试用已结束"
      : "License 已失效";
  const description =
    mode === "trial-expired"
      ? "您的免费试用已到期，请输入 License Key 激活后继续使用。"
      : status?.message ?? "您的 License 已失效，请重新激活或联系客服。";

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/license/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ licenseKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "激活失败");
        return;
      }
      setLicenseKey("");
      await refresh();
    } catch {
      setError("网络错误，激活失败");
    } finally {
      setBusy(false);
    }
  }

  async function retrySync() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/license/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok && !data.allowed) {
        setError(data.message ?? data.error ?? "同步失败");
      }
      await refresh();
    } catch {
      setError("网络错误，同步失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={shouldShowGate}>
      <DialogContent hideClose className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={activate} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="gate-license-key">License Key</Label>
            <Input
              id="gate-license-key"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="INKP-..."
              autoComplete="off"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !licenseKey.trim()} className="w-full">
            <KeyRound className="h-4 w-4" />
            {busy ? "处理中..." : "激活 License"}
          </Button>
        </form>

        <div className="space-y-2">
          <Button variant="outline" size="sm" className="w-full" onClick={() => void retrySync()} disabled={busy}>
            <RefreshCw className="h-4 w-4" />
            重试同步
          </Button>

          <div className="flex flex-col gap-1.5 text-sm">
            <a
              href={purchaseLinks.primary}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1 text-primary hover:underline"
            >
              前往购买 License Key
              <ExternalLink className="h-3 w-3" />
            </a>
            {purchaseLinks.dev && (
              <a
                href={purchaseLinks.dev}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1 text-xs text-muted-foreground hover:underline"
              >
                开发服务（{purchaseLinks.dev}）
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
