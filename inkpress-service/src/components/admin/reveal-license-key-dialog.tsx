"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function RevealLicenseKeyDialog({
  licenseId,
  disabled,
}: {
  licenseId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPassword("");
    setLicenseKey(null);
    setCopied(false);
    setError(null);
    setLoading(false);
  }

  async function reveal(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/admin/licenses/${licenseId}/reveal-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "查看失败");
        return;
      }
      setLicenseKey(data.data.licenseKey);
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!licenseKey) return;
    await navigator.clipboard.writeText(licenseKey);
    setCopied(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          查看 Key
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>查看 License Key</DialogTitle>
          <DialogDescription>
            输入服务端配置的查看密码后展示完整 Key；关闭弹窗后会清空本次显示。
          </DialogDescription>
        </DialogHeader>

        {licenseKey ? (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 dark:bg-amber-950/20">
              <div className="text-xs text-muted-foreground">License Key（明文）</div>
              <code className="mt-1 block break-all font-mono text-base font-semibold">
                {licenseKey}
              </code>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={copy}>
                {copied ? "已复制" : "复制 Key"}
              </Button>
              <Button onClick={() => setOpen(false)}>关闭</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={reveal} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="license-key-view-password">查看密码</Label>
              <Input
                id="license-key-view-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={loading || !password}>
                {loading ? "校验中..." : "查看"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
