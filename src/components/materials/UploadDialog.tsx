"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Upload, X, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Asset } from "@/types/asset";
import { splitTagInput } from "@/lib/asset";

type UploadTask = {
  id: string;
  file: File;
  progress: number; // 0-100
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  retries: number;
  /** true=分片上传（含断点续传），false=直接 multipart 直传 */
  chunked: boolean;
  /** 上传完成后回填的 asset id（用于「完成」时补写元数据） */
  assetId?: string;
  // 公众号素材库同步结果（仅当勾选 syncToWechat 时服务端返回）
  wxSyncStatus?: "success" | "failed" | null;
  wxSyncError?: string | null;
};

// ≤ 此阈值走直接上传（multipart），大于则走分片 + 断点续传
const DIRECT_UPLOAD_LIMIT = 5 * 1024 * 1024; // 5MB
const CHUNK_SIZE = 1024 * 1024; // 1MB

function formatSize(bytes: number) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 文件上传弹窗。两种入口模式：
 * - 点击上传（initialFiles=null）：先选文件 + 填描述/标签，点「确认上传」开始传（元数据随传携带）。
 * - 拖拽上传（initialFiles 非空）：弹窗打开即开始上传，边传边填，点「完成」时把已填描述/标签补写到已传完的素材。
 */
export function UploadDialog({
  open,
  onOpenChange,
  articleId,
  spaceId,
  initialFiles,
  onUploaded,
  onAllDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  articleId: string;
  spaceId?: string | null;
  /** 拖拽时预填的文件；null 表示点击进入（需在弹窗内选择） */
  initialFiles: File[] | null;
  onUploaded?: (asset: Asset) => void;
  onAllDone?: () => void;
}) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [syncToWechat, setSyncToWechat] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** true=拖拽进入，弹窗打开即上传；false=点击进入，先填表单再传 */
  const liveMode = initialFiles !== null;
  const [finalizing, setFinalizing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 弹窗打开 / 关闭时重置状态
  useEffect(() => {
    if (open) {
      setDescription("");
      setTags("");
      setSyncToWechat(false);
      setUploading(false);
      setFinalizing(false);
      if (initialFiles && initialFiles.length > 0) {
        // 拖拽：立即开始上传
        startUpload(initialFiles);
      } else {
        // 点击：清空任务，等待用户选文件
        setTasks([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFiles]);

  // ---- 直接上传小文件（multipart/form-data）----
  const uploadDirect = useCallback(
    async (task: UploadTask): Promise<{ id: string; wx?: { status: string | null; error: string | null } } | null> => {
      const fd = new FormData();
      fd.append("file", task.file);
      if (articleId) fd.append("articleId", articleId);
      if (spaceId) fd.append("spaceId", spaceId);
      // 点击模式：元数据随传携带
      if (!liveMode) {
        if (description.trim()) fd.append("description", description.trim());
        if (tags.trim()) fd.append("tags", tags.trim());
      }
      if (syncToWechat) fd.append("syncToWechat", "1");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "上传失败");
      }
      const data = (await res.json()) as {
        asset: Asset & { wxSyncStatus?: string | null; wxSyncError?: string | null };
      };
      return {
        id: data.asset.id,
        wx:
          data.asset.wxSyncStatus != null
            ? { status: data.asset.wxSyncStatus, error: data.asset.wxSyncError ?? "" }
            : undefined,
      };
    },
    [articleId, spaceId, liveMode, description, tags, syncToWechat]
  );

  // ---- 分片上传单个文件（含断点续传 + 重试）----
  const uploadChunked = useCallback(
    async (task: UploadTask): Promise<{ id: string; wx?: { status: string | null; error: string | null } } | null> => {
      const file = task.file;
      const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      const uploadId = task.id;
      const initRes = await fetch(
        `/api/upload/chunk?action=init&uploadId=${uploadId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            fileSize: file.size,
            contentType: file.type || "application/octet-stream",
            total,
            description: !liveMode ? description.trim() || undefined : undefined,
            tags: !liveMode ? tags.trim() || undefined : undefined,
            articleId,
            spaceId: spaceId ?? null,
            syncToWechat,
          }),
        }
      );
      if (!initRes.ok) {
        const d = await initRes.json().catch(() => ({}));
        throw new Error(d.error || "初始化失败");
      }
      // 断点续传：查已传分片
      const statusRes = await fetch(`/api/upload/chunk?uploadId=${uploadId}`);
      const status = statusRes.ok ? await statusRes.json() : { received: [] };
      const received = new Set<number>(status.received ?? []);
      for (let i = 0; i < total; i++) {
        if (received.has(i)) continue;
        const start = i * CHUNK_SIZE;
        const chunk = file.slice(start, start + CHUNK_SIZE);
        const buf = await chunk.arrayBuffer();
        const chunkRes = await fetch(
          `/api/upload/chunk?action=chunk&uploadId=${uploadId}&index=${i}`,
          { method: "POST", body: buf }
        );
        if (!chunkRes.ok) throw new Error("分片上传失败");
        const pct = Math.round(((i + 1) / total) * 100);
        setTasks((cur) =>
          cur.map((t) => (t.id === uploadId ? { ...t, progress: pct } : t))
        );
      }
      const completeRes = await fetch(
        `/api/upload/chunk?action=complete&uploadId=${uploadId}`
      );
      if (!completeRes.ok) {
        const d = await completeRes.json().catch(() => ({}));
        throw new Error(d.error || "合并失败");
      }
      const data = (await completeRes.json()) as {
        asset: Asset & { wxSyncStatus?: string | null; wxSyncError?: string | null };
      };
      return {
        id: data.asset.id,
        wx:
          data.asset.wxSyncStatus != null
            ? { status: data.asset.wxSyncStatus, error: data.asset.wxSyncError ?? "" }
            : undefined,
      };
    },
    [articleId, spaceId, liveMode, description, tags, syncToWechat]
  );

  const uploadOne = useCallback(
    async (task: UploadTask) => {
      try {
        const result = task.chunked
          ? await uploadChunked(task)
          : await uploadDirect(task);
        const assetId = result?.id ?? null;
        // 上传成功后取回完整 asset 通知外层
        let asset: Asset | null = null;
        if (assetId) {
          const res = await fetch(`/api/materials?articleId=${articleId}`);
          const data = await res.json();
          asset =
            (data.assets as Asset[])?.find((a) => a.id === assetId) ?? null;
        }
        setTasks((cur) =>
          cur.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  status: "done",
                  progress: 100,
                  assetId: assetId ?? undefined,
                  wxSyncStatus: (result?.wx?.status as UploadTask["wxSyncStatus"]) ?? null,
                  wxSyncError: result?.wx?.error ?? null,
                }
              : t
          )
        );
        if (asset) onUploaded?.(asset);
      } catch (e) {
        setTasks((cur) =>
          cur.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  status: "error",
                  error: e instanceof Error ? e.message : "上传失败",
                }
              : t
          )
        );
      }
    },
    [uploadChunked, uploadDirect, articleId, onUploaded]
  );

  /** 启动一批文件的上传（串行，避免并发竞争） */
  const startUpload = useCallback(
    (files: File[]) => {
      const newTasks: UploadTask[] = files.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        progress: 0,
        status: "uploading",
        retries: 0,
        chunked: f.size > DIRECT_UPLOAD_LIMIT,
      }));
      setTasks(newTasks);
      setUploading(true);
      (async () => {
        for (const t of newTasks) {
          await uploadOne(t);
        }
        setUploading(false);
      })();
    },
    [uploadOne]
  );

  // 自动重试（指数退避，最多 3 次）
  const retry = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      setTasks((cur) =>
        cur.map((t) =>
          t.id === taskId
            ? { ...t, status: "uploading", retries: t.retries + 1, error: undefined }
            : t
        )
      );
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, task.retries)));
      await uploadOne({ ...task, status: "uploading" });
    },
    [tasks, uploadOne]
  );

  /** 重试公众号素材库同步（OSS 已成功，仅 wx 同步失败的任务） */
  const retryWxSync = useCallback(async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task?.assetId) return;
    setTasks((cur) =>
      cur.map((t) =>
        t.id === taskId ? { ...t, wxSyncStatus: null, wxSyncError: null } : t
      )
    );
    try {
      const res = await fetch(`/api/materials/${task.assetId}/sync-wechat`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setTasks((cur) =>
          cur.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  wxSyncStatus: "failed",
                  wxSyncError: data.error || "同步失败",
                }
              : t
          )
        );
      } else {
        setTasks((cur) =>
          cur.map((t) =>
            t.id === taskId
              ? { ...t, wxSyncStatus: "success", wxSyncError: null }
              : t
          )
        );
      }
    } catch {
      setTasks((cur) =>
        cur.map((t) =>
          t.id === taskId
            ? { ...t, wxSyncStatus: "failed", wxSyncError: "网络错误" }
            : t
        )
      );
    }
  }, [tasks]);

  /** 点击模式：选完文件 + 填好表单后开始上传（由按钮直接调用 startUpload） */

  const selectedFiles = tasks.map((t) => t.file);

  /** 取消单个任务 */
  async function cancelTask(t: UploadTask) {
    if (t.chunked) {
      await fetch(`/api/upload/chunk?uploadId=${t.id}`, { method: "DELETE" });
    }
    setTasks((cur) => cur.filter((x) => x.id !== t.id));
  }

  const allDone =
    tasks.length > 0 && tasks.every((t) => t.status === "done");
  const hasError = tasks.some((t) => t.status === "error");

  /** 拖拽模式：完成时把已填描述/标签补写到已传完的素材 */
  async function finishWithMeta() {
    const desc = description.trim();
    const tagArr = splitTagInput(tags);
    const doneIds = tasks
      .filter((t) => t.status === "done" && t.assetId)
      .map((t) => t.assetId!) as string[];
    if (doneIds.length === 0) {
      onOpenChange(false);
      onAllDone?.();
      return;
    }
    setFinalizing(true);
    try {
      if (desc || tagArr.length) {
        await Promise.all(
          doneIds.map((id) =>
            fetch(`/api/materials/${id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                description: desc || undefined,
                tags: tagArr.length ? tagArr : undefined,
              }),
            })
          )
        );
      }
      onAllDone?.();
      onOpenChange(false);
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // 上传中禁止点遮罩/ESC 关闭（避免半传状态丢失）
        if (!v && uploading) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {liveMode ? "上传素材" : "选择并上传素材"}
          </DialogTitle>
          <DialogDescription>
            名称自动生成（短 UUID）。
            {liveMode
              ? "正在上传，可同时填写描述 / 标签，完成后补写到本批素材。"
              : "选择文件并填写描述 / 标签，点击确认上传。≤5MB 直传，更大自动分片续传。"}
          </DialogDescription>
        </DialogHeader>

        {/* 点击模式：选择文件区 */}
        {!liveMode && (
          <div
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded-md border border-dashed border-input p-3 text-center text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
          >
            <Upload className="h-4 w-4 mx-auto mb-1" />
            {tasks.length === 0
              ? "点击选择文件（支持多选）"
              : `已选 ${tasks.length} 个文件，点击重新选择`}
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length) {
                  // 点击模式：先列为待上传（pending），点「确认上传」再真正开始
                  setTasks(
                    Array.from(e.target.files).map((f) => ({
                      id: crypto.randomUUID(),
                      file: f,
                      progress: 0,
                      status: "pending" as const,
                      retries: 0,
                      chunked: f.size > DIRECT_UPLOAD_LIMIT,
                    }))
                  );
                }
                e.target.value = "";
              }}
            />
          </div>
        )}

        {/* 文件 / 任务列表（含进度） */}
        {tasks.length > 0 && (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {tasks.map((t) => (
              <div key={t.id} className="rounded-md border border-border p-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate">{t.file.name}</span>
                  <span className="text-muted-foreground shrink-0">
                    {formatSize(t.file.size)}
                  </span>
                  {t.status === "pending" && (
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      待上传
                    </span>
                  )}
                  {t.status === "done" && (
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  )}
                  {t.status === "error" && (
                    <button
                      onClick={() => retry(t.id)}
                      className="text-primary hover:underline shrink-0"
                    >
                      重试
                    </button>
                  )}
                  {t.status !== "uploading" && (
                    <button
                      onClick={() => cancelTask(t)}
                      className="text-muted-foreground hover:text-red-600 shrink-0"
                      title="移除"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {t.status !== "pending" && (
                  <div className="mt-1 h-1 rounded bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all",
                        t.status === "error" ? "bg-red-500" : "bg-primary"
                      )}
                      style={{ width: `${t.progress}%` }}
                    />
                  </div>
                )}
                {t.error && (
                  <p className="text-[11px] text-red-600 mt-1">{t.error}</p>
                )}
                {/* 公众号同步结果（仅勾选了同步时显示） */}
                {t.status === "done" && t.wxSyncStatus === "success" && (
                  <p className="text-[11px] text-emerald-600 mt-1">
                    ✓ 已同步公众号素材库
                  </p>
                )}
                {t.status === "done" && t.wxSyncStatus === "failed" && (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-amber-700 truncate">
                      ⚠ 公众号同步失败：{t.wxSyncError}
                    </p>
                    <button
                      onClick={() => retryWxSync(t.id)}
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline shrink-0"
                    >
                      <RefreshCw className="h-3 w-3" />
                      重试同步
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 同步到公众号素材库（勾选框） */}
        <label className="flex items-start gap-2 rounded-md border border-border p-2.5 cursor-pointer hover:bg-accent/40 transition-colors">
          <input
            type="checkbox"
            checked={syncToWechat}
            onChange={(e) => setSyncToWechat(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
          />
          <div className="space-y-0.5">
            <div className="text-xs font-medium">同步到公众号素材库</div>
            <div className="text-[11px] text-muted-foreground leading-relaxed">
              图片走 media/uploadimg（正文图 URL），视频/文件走永久素材。需已在「设置 → 微信公众号」配置 appId 与 secret；未配置或失败时素材仍入库，标记失败后可重试。
            </div>
          </div>
        </label>

        {/* 描述 / 标签（两种模式共用） */}
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label className="text-xs">描述</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例如：封面主视觉，深色科技感背景"
              rows={2}
              className="text-xs"
              disabled={uploading && !liveMode ? false : false}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">标签（逗号分隔）</Label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="封面, 主视觉, 科技"
              className="h-8 text-xs"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {liveMode ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
                取消
              </Button>
              <Button
                onClick={() => void finishWithMeta()}
                disabled={uploading || finalizing || tasks.length === 0}
              >
                {finalizing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {uploading ? "上传中…" : hasError ? "完成（部分失败）" : "完成"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
                {allDone ? "关闭" : "取消"}
              </Button>
              {!allDone && (
                <Button
                  onClick={() => {
                    if (selectedFiles.length === 0 || uploading) return;
                    // 点击模式：带上已填元数据开始上传
                    startUpload(selectedFiles);
                  }}
                  disabled={selectedFiles.length === 0 || uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploading ? "上传中…" : "确认上传"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
