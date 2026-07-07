"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

/**
 * License 续期弹窗：输入天数（1-3650）→ PATCH /api/admin/licenses/:id { extendDays }。
 * 仅对已激活、非永久、ENABLED 的 License 显示（由调用方控制触发按钮可见性）。
 */
export function ExtendLicenseDialog({
  licenseId,
  currentExpiresAt,
}: {
  licenseId: string;
  currentExpiresAt: Date | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      setError("续期天数需为 1-3650 之间的整数");
      return;
    }
    if (!window.confirm(`确认为此 License 续期 ${n} 天？`)) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/licenses/${licenseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extendDays: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "续期失败");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">续期</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>续期 License</DialogTitle>
          <DialogDescription>
            在当前到期时间基础上向后顺延；续期后有效期模板将变为自定义天数。
            {currentExpiresAt && (
              <> 当前到期：{new Date(currentExpiresAt).toLocaleString()}。</>
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ext-days">续期天数</Label>
            <Input
              id="ext-days"
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "处理中…" : "确认续期"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
