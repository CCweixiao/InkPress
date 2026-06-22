"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Upload,
  Copy,
  Check,
  Trash2,
  Loader2,
  ImageIcon,
  VideoIcon,
  FileIcon,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Asset = {
  id: string;
  name: string;
  ossKey: string;
  url: string;
  kind: string;
  size: number;
  contentType: string;
  createdAt: string;
  // 公众号素材库同步状态（可选，旧数据为 undefined）
  wxSyncStatus?: "success" | "failed" | null;
  wxSyncError?: string | null;
};

type Filter = "all" | "image" | "video" | "file";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
  { key: "file", label: "文件" },
];

function formatSize(bytes: number) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MaterialLibrary({
  assets,
  ossConfigured,
}: {
  assets: Asset[];
  ossConfigured: boolean;
}) {
  const [items, setItems] = useState(assets);
  const [filter, setFilter] = useState<Filter>("all");
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  /** 正在重试公众号同步的 asset id */
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setItems(assets);
  }, [assets]);

  async function refresh(kind: Filter) {
    const qs = kind === "all" ? "" : `?kind=${kind}`;
    const res = await fetch(`/api/materials${qs}`);
    const data = await res.json();
    setItems(data.assets ?? []);
  }

  async function onFilterChange(kind: Filter) {
    setFilter(kind);
    await refresh(kind);
  }

  async function handleUpload(files: FileList) {
    if (!ossConfigured) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || "上传失败");
        }
      }
      await refresh(filter);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  function remove(asset: Asset) {
    if (!window.confirm(`确认删除「${asset.name}」？`)) return;
    startTransition(async () => {
      const res = await fetch("/api/materials", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: asset.id }),
      });
      if (res.ok) setItems((cur) => cur.filter((a) => a.id !== asset.id));
    });
  }

  /** 重试公众号素材库同步（仅 wxSyncStatus=failed 的素材） */
  async function retryWxSync(asset: Asset) {
    setSyncingId(asset.id);
    try {
      const res = await fetch(`/api/materials/${asset.id}/sync-wechat`, {
        method: "POST",
      });
      const data = await res.json();
      setItems((cur) =>
        cur.map((a) =>
          a.id === asset.id
            ? {
                ...a,
                wxSyncStatus: res.ok ? "success" : "failed",
                wxSyncError: res.ok ? null : data.error || "同步失败",
              }
            : a
        )
      );
      if (!res.ok) window.alert(data.error || "同步失败");
    } catch {
      window.alert("网络错误，同步失败");
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {!ossConfigured && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
          尚未配置 OSS，素材上传不可用。请先到{" "}
          <a href="/settings" className="underline font-medium">
            设置 → OSS 配置
          </a>{" "}
          完成配置。
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-md bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className={cn(
                "px-3 py-1.5 rounded text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          disabled={!ossConfigured || uploading}
          onChange={(e) => e.target.files && handleUpload(e.target.files)}
        />
        <Button
          size="sm"
          disabled={!ossConfigured || uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          上传素材
        </Button>
      </div>

      {/* 网格 */}
      {items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">
              {ossConfigured ? "还没有素材，点击右上角上传" : "配置 OSS 后即可上传素材"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((asset) => (
            <Card key={asset.id} className="overflow-hidden group">
              <div className="aspect-video bg-muted/40 flex items-center justify-center overflow-hidden">
                {asset.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.url}
                    alt={asset.name}
                    className="w-full h-full object-cover"
                  />
                ) : asset.kind === "video" ? (
                  <VideoIcon className="h-10 w-10 text-muted-foreground/50" />
                ) : (
                  <FileIcon className="h-10 w-10 text-muted-foreground/50" />
                )}
              </div>
              <div className="p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium truncate flex-1" title={asset.name}>
                    {asset.name}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{formatSize(asset.size)}</span>
                  <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
                </div>
                {asset.wxSyncStatus === "failed" && (
                  <div className="flex items-center gap-1">
                    <Badge variant="warning">公众号同步失败</Badge>
                    <span
                      className="text-[10px] text-amber-700/80 truncate"
                      title={asset.wxSyncError ?? ""}
                    >
                      {asset.wxSyncError}
                    </span>
                  </div>
                )}
                {asset.wxSyncStatus === "success" && (
                  <div>
                    <Badge variant="success">已同步公众号</Badge>
                  </div>
                )}
                <div className="flex items-center gap-1 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 text-xs"
                    onClick={() => copyUrl(asset.url)}
                  >
                    {copied === asset.url ? (
                      <>
                        <Check className="h-3 w-3" /> 已复制
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> 复制链接
                      </>
                    )}
                  </Button>
                  {asset.wxSyncStatus === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0 text-amber-600 hover:text-amber-700"
                      title="重试同步到公众号"
                      disabled={syncingId === asset.id}
                      onClick={() => retryWxSync(asset)}
                    >
                      {syncingId === asset.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                    onClick={() => remove(asset)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
