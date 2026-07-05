"use client";

import { useState, useTransition } from "react";
import { Trash2, Pencil, EyeOff, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * 行级操作：状态切换 + 编辑 + 删除。
 *
 * 当前最小可用版本：
 * - 点击徽章快速切换 PUBLISHED / HIDDEN
 * - 编辑按钮打开 dialog（仅 displayName/changelog，本轮先简化为 alert）
 * - 删除按钮二次确认
 *
 * 后续可在 admin-table 升级为完整 dialog 编辑。
 */
export function ReleasesAdminTable(props: {
  id: string;
  initialStatus: string;
  initialDisplayName: string;
  initialLogoUrl: string;
  initialChangelogMarkdown: string;
  initialHighlights: string[];
  initialChannel: "stable" | "beta";
}) {
  const [status, setStatus] = useState(props.initialStatus);
  const [pending, start] = useTransition();

  function toggleStatus() {
    const next = status === "PUBLISHED" ? "HIDDEN" : "PUBLISHED";
    start(async () => {
      const res = await fetch(`/api/admin/releases/${props.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setStatus(next);
      } else {
        alert(data?.error?.message ?? "更新失败");
      }
    });
  }

  function handleDelete() {
    if (!confirm(`确认删除 ${props.initialDisplayName} 这条版本记录？\n\n注意：删除后该版本不会出现在 /downloads 页面，但 OSS 文件不会被自动清理。`)) {
      return;
    }
    start(async () => {
      const res = await fetch(`/api/admin/releases/${props.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        // 行级硬删除：直接刷新页面让表格重新渲染
        window.location.reload();
      } else {
        alert(data?.error?.message ?? "删除失败");
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggleStatus}
        disabled={pending}
        title={status === "PUBLISHED" ? "点击隐藏" : "点击恢复公开"}
        className="inline-flex items-center"
      >
        <Badge variant={status === "PUBLISHED" ? "default" : "secondary"}>
          {status === "PUBLISHED" ? (
            <Eye className="mr-1 h-3 w-3" />
          ) : (
            <EyeOff className="mr-1 h-3 w-3" />
          )}
          {status}
        </Badge>
      </button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        disabled={pending}
        title="编辑（即将支持完整 dialog）"
        onClick={() =>
          alert("完整编辑功能下一轮交付；本轮可改状态（点击徽章）或删除。")
        }
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
        disabled={pending}
        title="删除"
        onClick={handleDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
