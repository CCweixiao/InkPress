"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
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
import {
  extractImageFiles,
  normalizePastedImages,
  pasteShortcutLabel,
  useProactiveClipboardRead,
} from "@/components/materials/useClipboardImagePaste";
import { ImagePreviewDialog } from "@/components/materials/ImagePreviewDialog";

type UploadTask = {
  id: string;
  file: File;
  progress: number; // 0-100
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  retries: number;
  /** true=分片上传（含断点续传），false=直接 multipart 直传 */
  chunked: boolean;
  /** 是否勾选（暂存盘多选）：undefined / true 视为选中。仅对 pending 有意义。 */
  selected?: boolean;
  /** 上传完成后回填的 asset id（用于「完成」时补写元数据） */
  assetId?: string;
  // 公众号素材库同步结果（仅当勾选 syncToWechat 时服务端返回）
  wxSyncStatus?: "success" | "failed" | null;
  wxSyncError?: string | null;
};

/** selected 字段缺失视为选中（默认勾选）。 */
const isTaskSelected = (t: UploadTask) => t.selected !== false;

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
 * - 拖拽 / 粘贴上传（initialFiles 非空）：弹窗打开即开始上传，边传边填，点「完成」时把已填描述/标签补写到已传完的素材。
 *   弹窗已开时再次粘贴，宿主通过 ref.addFiles() 追加到当前批次（不重置任务）。
 */
export type UploadDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 归属文章；空表示空间级 / 未分类（API 层可选）。 */
  articleId?: string | null;
  spaceId?: string | null;
  /** 拖拽 / 粘贴时预填的文件；null 表示点击进入（需在弹窗内选择） */
  initialFiles: File[] | null;
  onUploaded?: (asset: Asset) => void;
  onAllDone?: () => void;
};

/**
 * 命令式句柄：弹窗已开时，宿主（粘贴监听器）调用 addFiles 追加文件到当前批次，
 * 而不必关再开（关再开会触发 [open, initialFiles] reset effect 重置任务列表）。
 */
export type UploadDialogHandle = {
  addFiles: (files: File[]) => void;
};

export const UploadDialog = forwardRef<UploadDialogHandle, UploadDialogProps>(
  function UploadDialog({
    open,
    onOpenChange,
    articleId,
    spaceId,
    initialFiles,
    onUploaded,
    onAllDone,
  }: UploadDialogProps,
    ref
  ) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [syncToWechat, setSyncToWechat] = useState(false);
  const [convertSvgToPng, setConvertSvgToPng] = useState(true);
  const [uploading, setUploading] = useState(false);
  /** true=拖拽 / 粘贴进入，弹窗打开即上传；false=点击进入，先填表单再传 */
  const liveMode = initialFiles !== null;
  const [finalizing, setFinalizing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 进行中的上传数（startUpload / addFiles 共用），归零才解除 uploading。 */
  const inFlightRef = useRef(0);
  /** 图片任务的 object URL（任务行缩略图用）。state 以便渲染；effect 负责增删 + 回收。 */
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const thumbUrlsRef = useRef<Record<string, string>>({});
  /** 粘贴非图片时的瞬时提示（2.5s 自清）。 */
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  /** 图片预览：点击缩略图放大查看（存 url + 文件名）。 */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | undefined>(undefined);

  // 弹窗打开 / 关闭时重置状态
  useEffect(() => {
    if (open) {
      setDescription("");
      setTags("");
      setSyncToWechat(false);
      setConvertSvgToPng(true);
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
      // 服务端默认 ON，只有显式关闭时才传 "0"，减少数据量
      if (!convertSvgToPng) fd.append("convertSvgToPng", "0");
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
    [articleId, spaceId, liveMode, description, tags, syncToWechat, convertSvgToPng]
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
            convertSvgToPng,
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
    [articleId, spaceId, liveMode, description, tags, syncToWechat, convertSvgToPng]
  );

  const uploadOne = useCallback(
    async (task: UploadTask) => {
      // 共享 in-flight 计数：startUpload 与 addFiles 都通过它正确维护 uploading，
      // 只有所有批次都结束（计数归零）才解除「上传中」。
      inFlightRef.current += 1;
      setUploading(true);
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
      } finally {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        if (inFlightRef.current === 0) setUploading(false);
      }
    },
    [uploadChunked, uploadDirect, articleId, onUploaded]
  );

  /** 启动一批文件的上传（串行，避免并发竞争）。uploading 由 uploadOne 的 in-flight 计数维护。 */
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
      (async () => {
        for (const t of newTasks) {
          await uploadOne(t);
        }
      })();
    },
    [uploadOne]
  );

  /**
   * 追加文件到当前批次（弹窗已开时粘贴 / 主动读剪贴板调用）。不动 initialFiles / 不触发 reset effect。
   * - liveMode（拖拽 / 粘贴进入）：追加为 uploading 并立即串行上传；
   * - 点击模式：追加为 pending（默认选中），进暂存盘等用户勾选后点「确认上传」。
   * - 去重：与已有任务同 size+type+lastModified 的文件跳过（避免「主动读 + 紧接着粘贴同一张」重复）。
   *   注意：上传副作用在 setTasks 之外发起——绝不能写在 updater 里（StrictMode 会双调用 → 重复上传）。
   */
  const addFiles = useCallback(
    (files: File[]) => {
      if (!open || files.length === 0) return;
      const status: UploadTask["status"] = liveMode ? "uploading" : "pending";
      const appended = files
        .filter(
          (f) =>
            !tasks.some(
              (t) =>
                t.file.size === f.size &&
                t.file.type === f.type &&
                t.file.lastModified === f.lastModified
            )
        )
        .map((f) => ({
          id: crypto.randomUUID(),
          file: f,
          progress: 0,
          status,
          retries: 0,
          chunked: f.size > DIRECT_UPLOAD_LIMIT,
        }));
      if (appended.length === 0) return;
      setTasks((cur) => [...cur, ...appended]);
      if (liveMode) {
        (async () => {
          for (const t of appended) await uploadOne(t);
        })();
      }
    },
    [open, liveMode, uploadOne, tasks]
  );

  useImperativeHandle(ref, () => ({ addFiles }), [addFiles]);

  // 点击模式：主动读一次当前剪贴板（若有截图，免 ⌘V 直接进暂存盘）。
  // live 模式不开（那是「现在就传」快捷通道，不混入选择流）。失败/拒绝/非图片静默回落。
  useProactiveClipboardRead({
    enabled: open && !liveMode,
    onImage: (file) => addFiles([file]),
  });

  /** 点击模式：只上传「勾选 + pending」的任务（暂存盘多选语义）。 */
  const uploadSelectedPending = useCallback(() => {
    if (uploading) return;
    const toUpload = tasks.filter(
      (t) => t.status === "pending" && isTaskSelected(t)
    );
    if (toUpload.length === 0) return;
    const ids = new Set(toUpload.map((t) => t.id));
    setTasks((cur) =>
      cur.map((t) => (ids.has(t.id) ? { ...t, status: "uploading" } : t))
    );
    (async () => {
      for (const t of toUpload) await uploadOne(t);
    })();
  }, [tasks, uploading, uploadOne]);

  // 缩略图 object URL：跟随 tasks 增删同步，避免泄漏（image 任务才创建）。
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const t of tasks) {
      // 复用已创建的（同一 File + 同一 id 不重复 createURL）
      if (thumbUrlsRef.current[t.id]) {
        next[t.id] = thumbUrlsRef.current[t.id];
      } else if (t.file.type.startsWith("image/")) {
        next[t.id] = URL.createObjectURL(t.file);
      }
    }
    // 回收被移除任务的 URL
    for (const [id, url] of Object.entries(thumbUrlsRef.current)) {
      if (!(id in next)) URL.revokeObjectURL(url);
    }
    thumbUrlsRef.current = next;
    setThumbUrls(next);
  }, [tasks]);

  // 卸载时回收全部 URL
  useEffect(() => {
    const cache = thumbUrlsRef.current;
    return () => {
      for (const url of Object.values(cache)) URL.revokeObjectURL(url);
    };
  }, []);

  // 弹窗打开时独占粘贴监听（宿主在 dialog 开时禁用自己的监听器，避免双触）。
  // 图片 → addFiles；有 item 但无图片 → 瞬时提示，不 preventDefault（文本放行）。
  useEffect(() => {
    if (!open) return;
    const handler = (event: ClipboardEvent) => {
      const files = extractImageFiles(event.clipboardData);
      if (files.length > 0) {
        event.preventDefault();
        addFiles(normalizePastedImages(files));
        return;
      }
      if ((event.clipboardData?.items?.length ?? 0) > 0) {
        setPasteHint("粘贴仅支持图片，其他文件请点击选择或拖拽");
        window.setTimeout(() => setPasteHint(null), 2500);
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [open, addFiles]);

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

  // 暂存盘多选（仅对 pending 有意义）：派生计数 + 切换 / 全选。
  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const selectedPendingCount = pendingTasks.filter(isTaskSelected).length;

  function toggleSelected(taskId: string) {
    setTasks((cur) =>
      cur.map((t) =>
        t.id === taskId && t.status === "pending"
          ? { ...t, selected: !isTaskSelected(t) }
          : t
      )
    );
  }

  function toggleSelectAllPending() {
    if (pendingTasks.length === 0) return;
    const allSelected = pendingTasks.every(isTaskSelected);
    setTasks((cur) =>
      cur.map((t) =>
        t.status === "pending" ? { ...t, selected: !allSelected } : t
      )
    );
  }

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
    <>
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
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              也可直接 {pasteShortcutLabel()} 粘贴图片到此弹窗
            </p>
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

        {/* 粘贴非图片时的瞬时提示 */}
        {pasteHint && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {pasteHint}
          </p>
        )}

        {/* 文件 / 任务列表（含进度 + 暂存盘多选） */}
        {tasks.length > 0 && (
          <div className="space-y-1.5">
            {/* 点击模式：暂存盘多选工具条（全选 + 计数） */}
            {!liveMode && pendingTasks.length > 0 && (
              <div className="flex items-center justify-between px-0.5 text-[11px] text-muted-foreground">
                <button
                  type="button"
                  onClick={toggleSelectAllPending}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={pendingTasks.every(isTaskSelected)}
                    className="h-3 w-3"
                  />
                  全选
                </button>
                <span>
                  已选 {selectedPendingCount} / {pendingTasks.length}
                </span>
              </div>
            )}
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {tasks.map((t) => (
                <div key={t.id} className="rounded-md border border-border p-2">
                  <div className="flex items-center gap-2 text-xs">
                    {t.status === "pending" ? (
                      <input
                        type="checkbox"
                        checked={isTaskSelected(t)}
                        onChange={() => toggleSelected(t.id)}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                    ) : (
                      <span className="w-3.5 shrink-0" aria-hidden />
                    )}
                    {thumbUrls[t.id] ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewUrl(thumbUrls[t.id]);
                          setPreviewName(t.file.name);
                        }}
                        className="shrink-0 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                        title="点击预览放大"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbUrls[t.id]}
                          alt=""
                          className="h-8 w-8 rounded object-cover"
                        />
                      </button>
                    ) : (
                      <div className="h-8 w-8 rounded bg-muted/60 shrink-0" />
                    )}
                    <span
                      className={cn(
                        "flex-1 truncate",
                        t.status === "pending" &&
                          !isTaskSelected(t) &&
                          "text-muted-foreground/50 line-through"
                      )}
                    >
                      {t.file.name}
                    </span>
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

        {/* SVG 自动转 PNG（公众号素材库不支持 SVG，默认开启） */}
        <label className="flex items-start gap-2 rounded-md border border-border p-2.5 cursor-pointer hover:bg-accent/40 transition-colors">
          <input
            type="checkbox"
            checked={convertSvgToPng}
            onChange={(e) => setConvertSvgToPng(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
          />
          <div className="space-y-0.5">
            <div className="text-xs font-medium">SVG 自动转 PNG</div>
            <div className="text-[11px] text-muted-foreground leading-relaxed">
              公众号素材库不支持 SVG，开启后上传时会自动转为 PNG 再存储。建议保持开启。Mermaid 图表也会走同样链路。
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
                  onClick={() => uploadSelectedPending()}
                  disabled={selectedPendingCount === 0 || uploading}
                  title={
                    selectedPendingCount === 0
                      ? "勾选要上传的图片"
                      : undefined
                  }
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploading
                    ? "上传中…"
                    : `上传选中的 ${selectedPendingCount} 项`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ImagePreviewDialog
      url={previewUrl}
      name={previewName}
      open={previewUrl !== null}
      onOpenChange={(v) => {
        if (!v) setPreviewUrl(null);
      }}
    />
    </>
  );
}
);

UploadDialog.displayName = "UploadDialog";
