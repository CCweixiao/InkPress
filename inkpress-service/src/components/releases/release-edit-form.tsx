"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * 发布版本编辑表单。
 *
 * 仅允许修改：displayName / logoUrl / channel / status / changelogMarkdown / highlights。
 * packageName / platform / version / 文件信息（fileName/size/hash/downloadUrl）由 CI 写入，
 * 管理员不能改——任何「相同版本不同文件」场景都应走 CI 重新 upsert。
 */
export interface ReleaseEditFormProps {
  id: string;
  initialDisplayName: string;
  initialLogoUrl: string;
  initialChannel: "stable" | "beta" | "rc" | "snapshot";
  initialStatus: "PUBLISHED" | "HIDDEN";
  initialChangelogMarkdown: string;
  initialHighlights: string[];
  /** 用于删除二次确认展示 */
  packageLabel: string;
}

const CHANNEL_OPTIONS: {
  value: "stable" | "beta" | "rc" | "snapshot";
  label: string;
  hint: string;
}[] = [
  { value: "stable", label: "正式版", hint: "推荐所有用户使用" },
  { value: "beta", label: "公测版", hint: "欢迎体验并反馈" },
  { value: "rc", label: "候选版", hint: "仅修复 blocker" },
  { value: "snapshot", label: "快照版", hint: "开发构建，可能不稳定" },
];

export function ReleaseEditForm(props: ReleaseEditFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [displayName, setDisplayName] = useState(props.initialDisplayName);
  const [logoUrl, setLogoUrl] = useState(props.initialLogoUrl);
  const [channel, setChannel] = useState(props.initialChannel);
  const [status, setStatus] = useState(props.initialStatus);
  const [changelog, setChangelog] = useState(props.initialChangelogMarkdown);
  const [highlights, setHighlights] = useState<string[]>(
    props.initialHighlights.length > 0 ? props.initialHighlights : [""]
  );
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function updateHighlight(i: number, v: string) {
    setHighlights((arr) => arr.map((x, idx) => (idx === i ? v : x)));
  }
  function addHighlight() {
    setHighlights((arr) => [...arr, ""]);
  }
  function removeHighlight(i: number) {
    setHighlights((arr) => (arr.length === 1 ? [] : arr.filter((_, idx) => idx !== i)));
  }

  function handleSave() {
    setError(null);
    start(async () => {
      const body: Record<string, unknown> = {
        displayName: displayName.trim(),
        channel,
        status,
      };
      if (logoUrl.trim() !== props.initialLogoUrl) {
        body.logoUrl = logoUrl.trim() === "" ? null : logoUrl.trim();
      }
      if (changelog.trim() !== props.initialChangelogMarkdown) {
        body.changelogMarkdown = changelog.trim() === "" ? null : changelog.trim();
      }
      const cleanedHighlights = highlights
        .map((h) => h.trim())
        .filter((h) => h.length > 0);
      // 与初始值不同才提交（避免空数组与默认 [] 的语义差异）
      if (JSON.stringify(cleanedHighlights) !== JSON.stringify(props.initialHighlights)) {
        body.highlights = cleanedHighlights;
      }

      const res = await fetch(`/api/admin/releases/${props.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setSavedAt(Date.now());
        router.refresh();
      } else {
        setError(data?.error?.message ?? "保存失败");
      }
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `确认删除「${props.packageLabel}」这条版本记录？\n\n` +
          "注意：\n" +
          "• 该版本不会出现在 /downloads 公开页\n" +
          "• OSS 上的实际文件不会被自动清理\n" +
          "• 此操作不可恢复"
      )
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/releases/${props.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        router.push("/admin/releases");
        router.refresh();
      } else {
        setError(data?.error?.message ?? "删除失败");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="displayName">展示名称</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="logoUrl">Logo URL（可空）</Label>
          <Input
            id="logoUrl"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://oss.../logo.png"
            maxLength={2048}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>通道</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CHANNEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setChannel(opt.value)}
                className={cn(
                  "rounded-md border px-3 py-2 text-left text-xs transition-colors",
                  channel === opt.value
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-accent"
                )}
              >
                <div className="font-medium">{opt.label}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {opt.hint}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>状态</Label>
          <div className="flex gap-2">
            {(["PUBLISHED", "HIDDEN"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                  status === s
                    ? s === "PUBLISHED"
                      ? "border-emerald-500 bg-emerald-500/5 text-emerald-700"
                      : "border-amber-500 bg-amber-500/5 text-amber-700"
                    : "hover:bg-accent"
                )}
              >
                {s === "PUBLISHED" ? "公开" : "隐藏"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="changelog">更新日志（Markdown）</Label>
        <Textarea
          id="changelog"
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
          rows={8}
          placeholder={"## 新功能\n- ...\n\n## 修复\n- ..."}
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          支持 # ## ### 标题、-/* 列表、空行分段
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>本次更新亮点</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addHighlight}
            disabled={pending}
          >
            <Plus className="mr-1 h-3 w-3" />
            添加
          </Button>
        </div>
        <div className="space-y-2">
          {highlights.length === 0 && (
            <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
              没有亮点。点击「添加」增加一条。
            </p>
          )}
          {highlights.map((h, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={h}
                onChange={(e) => updateHighlight(i, e.target.value)}
                maxLength={200}
                placeholder={`亮点 ${i + 1}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeHighlight(i)}
                disabled={pending}
                title="移除"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-4">
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={pending}>
            {pending ? "保存中…" : "保存修改"}
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/releases">返回列表</Link>
          </Button>
          {savedAt && !pending && (
            <span className="self-center text-xs text-emerald-600">
              已保存 {new Date(savedAt).toLocaleTimeString("zh-CN")}
            </span>
          )}
        </div>
        <Button
          onClick={handleDelete}
          disabled={pending}
          variant="destructive"
          className="gap-1.5"
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除此版本
        </Button>
      </div>
    </div>
  );
}
