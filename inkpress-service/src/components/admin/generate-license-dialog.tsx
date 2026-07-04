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

interface CreatedKey {
  id: string;
  licenseKey: string;
  keyFingerprint: string;
  maxDevices: number;
  durationKind: string;
  inviterCode?: string;
}

interface BatchResult {
  items: CreatedKey[];
  count: number;
  batchNo: string | null;
}

const DURATIONS = [
  { value: "YEAR_1", label: "1 年" },
  { value: "YEAR_3", label: "3 年" },
  { value: "YEAR_5", label: "5 年" },
  { value: "CUSTOM_YEARS", label: "自定义（年）" },
  { value: "CUSTOM_DAYS", label: "自定义（天）" },
  { value: "PERMANENT", label: "永久" },
];

export function GenerateLicenseDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [durationKind, setDurationKind] = useState("YEAR_1");
  const [durationYears, setDurationYears] = useState("1");
  const [durationDays, setDurationDays] = useState("30");
  const [maxDevices, setMaxDevices] = useState("1");
  const [inviterCode, setInviterCode] = useState("");
  const [note, setNote] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [count, setCount] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setDurationKind("YEAR_1");
    setDurationYears("1");
    setDurationDays("30");
    setMaxDevices("1");
    setInviterCode("");
    setNote("");
    setBatchNo("");
    setCount("1");
    setError(null);
    setResult(null);
    setCopied(false);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      if (result) router.refresh();
      reset();
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        durationKind,
        maxDevices: Number(maxDevices),
        count: Number(count),
      };
      if (durationKind === "CUSTOM_YEARS") payload.durationYears = Number(durationYears);
      if (durationKind === "CUSTOM_DAYS") payload.durationDays = Number(durationDays);
      if (inviterCode.trim()) payload.inviterCode = inviterCode.trim();
      if (note.trim()) payload.note = note.trim();
      if (batchNo.trim()) payload.batchNo = batchNo.trim();

      const res = await fetch("/api/admin/licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "创建失败");
        return;
      }
      setResult(data.data as BatchResult);
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  const isBatch = (result?.count ?? 1) > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>生成 License</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        {result ? (
          isBatch ? (
            <ShowKeys
              result={result}
              copied={copied}
              onCopy={async () => {
                await navigator.clipboard.writeText(
                  result.items.map((it) => it.licenseKey).join("\n")
                );
                setCopied(true);
              }}
              onClose={() => onOpenChange(false)}
            />
          ) : (
            <ShowKey
              created={result.items[0]}
              copied={copied}
              onCopy={async () => {
                await navigator.clipboard.writeText(result.items[0].licenseKey);
                setCopied(true);
              }}
              onClose={() => onOpenChange(false)}
            />
          )
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>生成 License Key</DialogTitle>
              <DialogDescription>
                可选绑定邀请码做归因；明文 Key 仅在创建后显示一次。
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="dk">有效期模板</Label>
                <select
                  id="dk"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={durationKind}
                  onChange={(e) => setDurationKind(e.target.value)}
                >
                  {DURATIONS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              {durationKind === "CUSTOM_YEARS" && (
                <div className="space-y-1.5">
                  <Label htmlFor="dy">年数</Label>
                  <Input id="dy" type="number" min={1} value={durationYears} onChange={(e) => setDurationYears(e.target.value)} />
                </div>
              )}
              {durationKind === "CUSTOM_DAYS" && (
                <div className="space-y-1.5">
                  <Label htmlFor="dd">天数</Label>
                  <Input id="dd" type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="md">设备数上限</Label>
                <Input id="md" type="number" min={1} value={maxDevices} onChange={(e) => setMaxDevices(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct">生成数量</Label>
                <Input id="ct" type="number" min={1} max={100} value={count} onChange={(e) => setCount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ic">邀请码（可选）</Label>
                <Input id="ic" value={inviterCode} onChange={(e) => setInviterCode(e.target.value)} placeholder="归因到邀请人" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="bn">批次号（可选）</Label>
                <Input id="bn" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="留空将自动生成" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="nt">备注（可选）</Label>
                <Input id="nt" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
              <DialogFooter className="col-span-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "创建中…" : "生成"}</Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ShowKey({
  created,
  copied,
  onCopy,
  onClose,
}: {
  created: CreatedKey;
  copied: boolean;
  onCopy: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>License Key 已生成</DialogTitle>
        <DialogDescription className="text-amber-600">
          明文 Key 仅显示这一次，关闭后无法再次查看，请立即复制保存。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 dark:bg-amber-950/20">
          <div className="text-xs text-muted-foreground">License Key（明文）</div>
          <code className="mt-1 block break-all font-mono text-base font-semibold">
            {created.licenseKey}
          </code>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-muted-foreground">指纹：</span><code className="font-mono">{created.keyFingerprint}</code></div>
          <div><span className="text-muted-foreground">设备上限：</span>{created.maxDevices}</div>
          {created.inviterCode && (
            <div><span className="text-muted-foreground">归因邀请码：</span>{created.inviterCode}</div>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCopy}>{copied ? "已复制" : "复制 Key"}</Button>
        <Button onClick={onClose}>我已保存，关闭</Button>
      </DialogFooter>
    </>
  );
}

function ShowKeys({
  result,
  copied,
  onCopy,
  onClose,
}: {
  result: BatchResult;
  copied: boolean;
  onCopy: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>已批量生成 {result.count} 个 License Key</DialogTitle>
        <DialogDescription className="text-amber-600">
          明文 Key 仅显示这一次，关闭后无法再次查看，请立即复制保存。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-muted-foreground">批次号：</span><code className="font-mono">{result.batchNo ?? "—"}</code></div>
          <div><span className="text-muted-foreground">数量：</span>{result.count}</div>
          {result.items[0]?.inviterCode && (
            <div><span className="text-muted-foreground">归因邀请码：</span>{result.items[0].inviterCode}</div>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto rounded-md border border-amber-500/40 bg-amber-50 p-3 dark:bg-amber-950/20">
          <ol className="space-y-1.5">
            {result.items.map((it, idx) => (
              <li key={it.id} className="text-sm">
                <span className="text-muted-foreground">{idx + 1}. </span>
                <code className="break-all font-mono font-semibold">{it.licenseKey}</code>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCopy}>{copied ? "已复制" : "全部复制"}</Button>
        <Button onClick={onClose}>我已保存，关闭</Button>
      </DialogFooter>
    </>
  );
}
