"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CHANNEL_OPTIONS = [
  { value: "stable", label: "正式版", hint: "推荐所有用户使用" },
  { value: "beta", label: "公测版", hint: "欢迎体验并反馈" },
  { value: "rc", label: "候选版", hint: "仅修复 blocker" },
  { value: "snapshot", label: "快照版", hint: "开发构建" },
] as const;

export function VersionCreateForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [packageName, setPackageName] = useState("inkpress");
  const [version, setVersion] = useState("");
  const [displayName, setDisplayName] = useState("InkPress 桌面版");
  const [channel, setChannel] = useState<"stable" | "beta" | "rc" | "snapshot">("stable");
  const [changelog, setChangelog] = useState("");
  const [highlights, setHighlights] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);

  function updateHighlight(i: number, v: string) {
    setHighlights((arr) => arr.map((x, idx) => (idx === i ? v : x)));
  }
  function addHighlight() {
    setHighlights((arr) => [...arr, ""]);
  }
  function removeHighlight(i: number) {
    setHighlights((arr) => (arr.length === 1 ? [] : arr.filter((_, idx) => idx !== i)));
  }

  function handleSubmit() {
    setError(null);
    start(async () => {
      const cleanedHighlights = highlights.map((h) => h.trim()).filter((h) => h.length > 0);
      const body: Record<string, unknown> = {
        packageName: packageName.trim(),
        version: version.trim(),
        displayName: displayName.trim(),
        channel,
        highlights: cleanedHighlights,
      };
      if (changelog.trim()) body.changelogMarkdown = changelog.trim();

      const res = await fetch("/api/admin/releases/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        router.push("/admin/releases");
        router.refresh();
      } else {
        setError(data?.error?.message ?? "创建失败");
      }
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="packageName">包名</Label>
          <Input id="packageName" value={packageName} onChange={(e) => setPackageName(e.target.value)} maxLength={64} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="version">版本号</Label>
          <Input id="version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="0.5.0" maxLength={64} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="displayName">展示名称</Label>
        <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} />
      </div>

      <div className="space-y-1.5">
        <Label>通道</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CHANNEL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setChannel(opt.value)}
              className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                channel === opt.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent"
              }`}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{opt.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="changelog">更新日志（Markdown）</Label>
        <Textarea
          id="changelog"
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
          rows={6}
          placeholder={"## 新功能\n- ..."}
          className="font-mono text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>本次更新亮点</Label>
          <Button type="button" variant="outline" size="sm" onClick={addHighlight} disabled={pending}>
            <Plus className="mr-1 h-3 w-3" />
            添加
          </Button>
        </div>
        <div className="space-y-2">
          {highlights.map((h, i) => (
            <div key={i} className="flex gap-2">
              <Input value={h} onChange={(e) => updateHighlight(i, e.target.value)} maxLength={200} placeholder={`亮点 ${i + 1}`} />
              <Button type="button" variant="ghost" size="sm" className="h-9 w-9 shrink-0 p-0" onClick={() => removeHighlight(i)} disabled={pending}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      <div className="flex gap-2 border-t pt-4">
        <Button onClick={handleSubmit} disabled={pending || !version.trim()}>
          {pending ? "创建中…" : "创建版本"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/releases">取消</Link>
        </Button>
      </div>
    </div>
  );
}
