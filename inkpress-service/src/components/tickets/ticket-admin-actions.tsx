"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TicketStatusBadge } from "./ticket-status-badge";

interface TicketAdminActionsProps {
  ticketId: string;
  status: string;
  priority: string;
}

const STATUS_OPTIONS = ["OPEN", "ANSWERED", "RESOLVED", "CLOSED"] as const;
const STATUS_LABELS: Record<string, string> = {
  OPEN: "待处理",
  ANSWERED: "已回复",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
};
const PRIORITY_OPTIONS = ["LOW", "NORMAL", "HIGH"] as const;
const PRIORITY_LABELS: Record<string, string> = {
  LOW: "低",
  NORMAL: "正常",
  HIGH: "高",
};

export function TicketAdminActions({
  ticketId,
  status,
  priority,
}: TicketAdminActionsProps) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [currentPriority, setCurrentPriority] = useState(priority);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const handleChange = (newStatus: string, newPriority: string) => {
    setCurrentStatus(newStatus);
    setCurrentPriority(newPriority);
    setDirty(newStatus !== status || newPriority !== priority);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: currentStatus,
          priority: currentPriority,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "保存失败");
      } else {
        setDirty(false);
      }
    } catch {
      setError("网络错误");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">当前状态：</span>
        <TicketStatusBadge status={currentStatus} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">状态</span>
          <select
            value={currentStatus}
            onChange={(e) => handleChange(e.target.value, currentPriority)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">优先级</span>
          <select
            value={currentPriority}
            onChange={(e) => handleChange(currentStatus, e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>

        {dirty && (
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
