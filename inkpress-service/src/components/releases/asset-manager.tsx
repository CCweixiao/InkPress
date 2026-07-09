"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AssetRow {
  id: string;
  os: string;
  arch: string;
  fileName: string;
  fileSizeBytes: number;
  downloadCount: number;
  source: string;
}

export function AssetManager({
  versionId,
  initialAssets,
}: {
  versionId: string;
  initialAssets: AssetRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [assets, setAssets] = useState<AssetRow[]>(initialAssets);
  const [error, setError] = useState<string | null>(null);

  // 上传表单状态
  const [showUpload, setShowUpload] = useState(false);
  const [os, setOs] = useState("darwin");
  const [arch, setArch] = useState("arm64");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // 替换状态
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);

  function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleUpload() {
    if (!uploadFile) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append("os", os);
      fd.append("arch", arch);
      fd.append("file", uploadFile);
      const res = await fetch(`/api/admin/releases/versions/${versionId}/assets`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setShowUpload(false);
        setUploadFile(null);
        router.refresh();
      } else {
        setError(data?.error?.message ?? "上传失败");
      }
    });
  }

  function handleReplace(assetId: string) {
    if (!replaceFile) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append("file", replaceFile);
      const res = await fetch(`/api/admin/releases/versions/${versionId}/assets/${assetId}`, {
        method: "PATCH",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setReplaceId(null);
        setReplaceFile(null);
        router.refresh();
      } else {
        setError(data?.error?.message ?? "替换失败");
      }
    });
  }

  function handleDelete(assetId: string) {
    if (!confirm("确认删除这个架构包？OSS 上的文件会被清理，此操作不可恢复。")) return;
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/releases/versions/${versionId}/assets/${assetId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        router.refresh();
      } else {
        setError(data?.error?.message ?? "删除失败");
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">架构</th>
              <th className="px-3 py-2">文件名</th>
              <th className="px-3 py-2">大小</th>
              <th className="px-3 py-2">下载</th>
              <th className="px-3 py-2">来源</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {assets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  暂无架构包。点击下方「上传架构包」添加。
                </td>
              </tr>
            )}
            {assets.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{a.os}-{a.arch}</td>
                <td className="px-3 py-2 text-xs">{a.fileName}</td>
                <td className="px-3 py-2 text-xs">{formatSize(a.fileSizeBytes)}</td>
                <td className="px-3 py-2 text-xs">{a.downloadCount} 次</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{a.source}</td>
                <td className="px-3 py-2 text-right">
                  {replaceId === a.id ? (
                    <div className="flex items-center justify-end gap-1">
                      <input type="file" onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)} />
                      <Button size="sm" onClick={() => handleReplace(a.id)} disabled={pending || !replaceFile}>
                        确认替换
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setReplaceId(null); setReplaceFile(null); }}>
                        取消
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setReplaceId(a.id)} disabled={pending} title="替换文件">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(a.id)} disabled={pending} title="删除">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showUpload ? (
        <div className="rounded-md border p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>OS</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={os} onChange={(e) => setOs(e.target.value)}>
                <option value="darwin">darwin (macOS)</option>
                <option value="win32">win32 (Windows)</option>
                <option value="linux">linux</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Arch</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={arch} onChange={(e) => setArch(e.target.value)}>
                <option value="arm64">arm64</option>
                <option value="x64">x64</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>文件</Label>
              <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleUpload} disabled={pending || !uploadFile}>
              {pending ? "上传中…" : "确认上传"}
            </Button>
            <Button variant="outline" onClick={() => { setShowUpload(false); setUploadFile(null); }}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowUpload(true)}>
          <Upload className="mr-1 h-3.5 w-3.5" />
          上传架构包
        </Button>
      )}
    </div>
  );
}
