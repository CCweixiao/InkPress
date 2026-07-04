"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, RefreshCw, ShieldAlert, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Status = {
  required: boolean;
  allowed: boolean;
  mode: "active" | "offline-grace" | "inactive" | "invalid" | "not-required";
  defaultServiceBaseUrl?: string;
  message?: string;
  state: null | {
    serviceBaseUrl: string;
    licenseFingerprint: string;
    status: string;
    effectiveExpiresAt: string | null;
    maxDevices: number;
    activatedDevices?: number;
    lastValidatedAt: string;
    offlineGraceExpiresAt: string;
  };
};

function formatDate(value: string | null | undefined) {
  if (!value) return "永久";
  return new Date(value).toLocaleString();
}

export function LicensePanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [serviceBaseUrl, setServiceBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/license/status", { cache: "no-store" });
    const data = (await res.json()) as Status;
    setStatus(data);
    setServiceBaseUrl((current) => current || data.state?.serviceBaseUrl || data.defaultServiceBaseUrl || "");
  }

  useEffect(() => {
    void load();
  }, []);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/license/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ licenseKey, serviceBaseUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "激活失败");
        return;
      }
      setLicenseKey("");
      setStatus(data as Status);
    } catch {
      setError("网络错误，激活失败");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/license/validate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setError(data.message ?? data.error ?? "License 校验失败");
      setStatus(data as Status);
    } catch {
      setError("网络错误，刷新失败");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!window.confirm("确认释放本机 License？此设备将不再占用席位。")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/license/deactivate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "释放失败");
        return;
      }
      setStatus(data as Status);
    } catch {
      setError("网络错误，释放失败");
    } finally {
      setBusy(false);
    }
  }

  const active = status?.allowed;

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
            {active ? "License 已生效" : "License 未生效"}
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <Info label="运行模式" value={status?.mode ?? "加载中"} />
          <Info label="服务端判定" value={status?.state?.status ?? "—"} />
          <Info label="License 指纹" value={status?.state?.licenseFingerprint ?? "—"} />
          <Info label="实际到期" value={formatDate(status?.state?.effectiveExpiresAt)} />
          <Info
            label="设备占用"
            value={
              status?.state
                ? `${status.state.activatedDevices ?? "—"} / ${status.state.maxDevices}`
                : "—"
            }
          />
          <Info label="最近校验" value={status?.state ? formatDate(status.state.lastValidatedAt) : "—"} />
          <Info label="离线宽限至" value={status?.state ? formatDate(status.state.offlineGraceExpiresAt) : "—"} />
          <Info label="服务地址" value={(status?.state?.serviceBaseUrl ?? serviceBaseUrl) || "—"} />
        </div>
        {status?.message && <p className="mt-3 text-sm text-muted-foreground">{status.message}</p>}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy || !status?.state}>
            <RefreshCw className="h-4 w-4" />
            手动刷新
          </Button>
          <Button variant="outline" size="sm" onClick={() => void deactivate()} disabled={busy || !status?.state}>
            <Unlink className="h-4 w-4" />
            释放本机
          </Button>
        </div>
      </div>

      <form onSubmit={activate} className="space-y-3 rounded-md border p-4">
        <div className="flex items-center gap-2 font-medium">
          <KeyRound className="h-5 w-5 text-primary" />
          激活 License
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1.3fr]">
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
          <div className="space-y-1.5">
            <Label htmlFor="license-service">License 服务地址</Label>
            <Input
              id="license-service"
              value={serviceBaseUrl}
              onChange={(e) => setServiceBaseUrl(e.target.value)}
              placeholder="https://license.example.com"
            />
          </div>
        </div>
        <Button type="submit" disabled={busy || !licenseKey.trim() || !serviceBaseUrl.trim()}>
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
