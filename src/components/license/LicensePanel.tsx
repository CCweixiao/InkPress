"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPurchaseLinks, useLicenseStatus, type LicenseStatus } from "@/components/license/LicenseStatusSync";

function formatDate(value: string | null | undefined) {
  if (!value) return "永久";
  return new Date(value).toLocaleString();
}

function formatRemainingDays(expiresAt: string | null | undefined): string {
  if (!expiresAt) return "永久";
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (remainingMs <= 0) return "已过期";
  const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  return `剩余 ${days} 天`;
}

function formatTrialRemaining(remainingMs: number | undefined): string {
  if (remainingMs === undefined || remainingMs <= 0) return "已结束";
  const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  const hours = Math.ceil(remainingMs / (60 * 60 * 1000));
  if (days >= 1) return `剩余 ${days} 天`;
  return `剩余 ${hours} 小时`;
}

export function LicensePanel() {
  const { status: syncedStatus, refresh } = useLicenseStatus();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const purchaseLinks = getPurchaseLinks();

  // 优先用全局同步状态，回退到本地加载
  useEffect(() => {
    if (syncedStatus) {
      setStatus(syncedStatus);
    }
  }, [syncedStatus]);

  async function load() {
    await refresh();
  }

  useEffect(() => {
    if (!status) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setStatus(data as LicenseStatus);
      await refresh();
    } catch {
      setError("网络错误，激活失败");
    } finally {
      setBusy(false);
    }
  }

  async function manualRefresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/license/validate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setError(data.message ?? data.error ?? "License 校验失败");
      setStatus(data as LicenseStatus);
      await refresh();
    } catch {
      setError("网络错误，刷新失败");
    } finally {
      setBusy(false);
    }
  }

  const active = status?.allowed;
  const isTrial = status?.mode === "trial";

  return (
    <div className="space-y-5">
      <div className="rounded-md border p-4">
        <div className="flex items-center gap-2">
          {active ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          ) : (
            <ShieldAlert className="h-5 w-5 text-amber-600" />
          )}
          <div className="font-medium">
            {active
              ? isTrial
                ? "试用中"
                : "License 已生效"
              : "License 未生效"}
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <Info label="运行模式" value={status?.mode ?? "加载中"} />
          <Info label="服务端判定" value={status?.state?.status ?? (isTrial ? "TRIAL" : "—")} />
          {!isTrial && <Info label="License 指纹" value={status?.state?.licenseFingerprint ?? "—"} />}
          {!isTrial && <Info label="激活时间" value={status?.state?.activatedAt ? formatDate(status.state.activatedAt) : "—"} />}
          {!isTrial && (
            <Info
              label="剩余天数"
              value={status?.state ? formatRemainingDays(status.state.effectiveExpiresAt) : "—"}
            />
          )}
          {!isTrial && <Info label="实际到期" value={formatDate(status?.state?.effectiveExpiresAt)} />}
          {isTrial && (
            <Info
              label="试用剩余"
              value={formatTrialRemaining(status?.trial?.remainingMs)}
            />
          )}
          {isTrial && <Info label="试用到期" value={formatDate(status?.trial?.trialExpiresAt)} />}
          {!isTrial && (
            <Info
              label="设备占用"
              value={
                status?.state
                  ? `${status.state.activatedDevices ?? "—"} / ${status.state.maxDevices}`
                  : "—"
              }
            />
          )}
          {!isTrial && <Info label="最近校验" value={status?.state ? formatDate(status.state.lastValidatedAt) : "—"} />}
          {!isTrial && <Info label="离线宽限至" value={status?.state ? formatDate(status.state.offlineGraceExpiresAt) : "—"} />}
        </div>
        {status?.message && <p className="mt-3 text-sm text-muted-foreground">{status.message}</p>}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {!isTrial && (
            <Button variant="outline" size="sm" onClick={() => void manualRefresh()} disabled={busy || !status?.state}>
              <RefreshCw className="h-4 w-4" />
              手动刷新
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <a href={purchaseLinks.primary} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              前往购买 Key
            </a>
          </Button>
        </div>
      </div>

      <form onSubmit={activate} className="space-y-3 rounded-md border p-4">
        <div className="flex items-center gap-2 font-medium">
          <KeyRound className="h-5 w-5 text-primary" />
          激活 License
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="license-key">License Key</Label>
          <Input
            id="license-key"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            placeholder="INKP-..."
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={busy || !licenseKey.trim()}>
          {busy ? "处理中..." : "激活"}
        </Button>
      </form>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-all">{value}</div>
    </div>
  );
}
