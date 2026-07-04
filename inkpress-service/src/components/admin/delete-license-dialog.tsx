"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LicenseLifecycleBadge } from "@/components/admin/status-badge";

/**
 * License 删除弹窗：硬删除，仅用于待激活/已过期的 key。
 * 成功后跳转列表页（详情页对象已不存在）。
 */
export function DeleteLicenseDialog({
  licenseId,
  keyFingerprint,
  displayKeySuffix,
  lifecycle,
}: {
  licenseId: string;
  keyFingerprint: string;
  displayKeySuffix: string;
  lifecycle: "PENDING" | "EXPIRED";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
    }
  }

  async function submit() {
    setError(null);
    if (
      !window.confirm(
        "此操作不可恢复，将永久删除该 License 及其激活记录与校验日志。确认继续？"
      )
    )
      return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/licenses/${licenseId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "删除失败");
        return;
      }
      setOpen(false);
      router.push("/admin/licenses");
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">删除</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>删除 License</DialogTitle>
          <DialogDescription>
            此操作不可恢复。将硬删除该 License，并级联清空其激活记录与校验日志。
            删除前会写一条审计日志（license.delete）记录快照。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">激活状态</span>
            <LicenseLifecycleBadge lifecycle={lifecycle} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">指纹</span>
            <code className="font-mono text-xs">{keyFingerprint}</code>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">后缀</span>
            <code className="font-mono text-xs">…{displayKeySuffix}</code>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={submit}
          >
            {submitting ? "处理中…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
