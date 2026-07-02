"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Copy,
  Check,
  Trash2,
  FileIcon,
  VideoIcon,
  Plus,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AssetEditDialog } from "@/components/materials/AssetEditDialog";
import {
  UploadDialog,
  type UploadDialogHandle,
} from "@/components/materials/UploadDialog";
import {
  useClipboardImagePaste,
  pasteShortcutLabel,
} from "@/components/materials/useClipboardImagePaste";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Asset } from "@/types/asset";
import { parseTags } from "@/lib/asset";

function formatSize(bytes: number) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 文章级素材管理面板：上传弹窗 + 列表 + 插入正文 + 元数据编辑 */
export function ArticleMaterialsPanel({
  articleId,
  spaceId,
  onInsert,
}: {
  articleId: string;
  spaceId?: string | null;
  onInsert: (md: string) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  // 上传弹窗：uploadInitial=null 表示点击进入（弹窗内选文件）；非空表示拖拽/粘贴进入（立即上传）
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadInitial, setUploadInitial] = useState<File[] | null>(null);
  // 素材编辑弹窗
  const [editing, setEditing] = useState<Asset | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const { confirm, dialog } = useConfirm();
  /** 面板根：element-scope 粘贴监听目标（需 tabIndex 才能在该区域聚焦时收到 paste）。 */
  const panelRef = useRef<HTMLDivElement>(null);
  /** 弹窗命令式句柄：弹窗已开时粘贴，追加文件而非重开。 */
  const dialogRef = useRef<UploadDialogHandle>(null);

  /** 粘贴图片：弹窗开→追加；关→用文件打开弹窗（live 模式立即上传）。 */
  const handlePastedFiles = useCallback((files: File[]) => {
    if (uploadOpen) {
      dialogRef.current?.addFiles(files);
      return;
    }
    setUploadInitial(files);
    setUploadOpen(true);
  }, [uploadOpen]);

  // element-scope：仅面板区域内粘贴生效，不与文章编辑器自带的图片粘贴打架。
  // 弹窗打开时禁用（由弹窗内部监听器独占，避免双触）。
  useClipboardImagePaste(panelRef, {
    enabled: !uploadOpen,
    scope: "element",
    onPaste: handlePastedFiles,
  });

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/materials?articleId=${articleId}`);
    const data = await res.json().catch(() => ({}));
    setAssets(data.assets ?? []);
    setLoading(false);
  }, [articleId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openUploadByClick() {
    // 聚焦面板，让后续 element-scope 粘贴监听能命中（粘贴图片追加到弹窗批次）。
    panelRef.current?.focus();
    setUploadInitial(null);
    setUploadOpen(true);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) {
      // 拖拽：打开弹窗并立即开始上传
      setUploadInitial(Array.from(e.dataTransfer.files));
      setUploadOpen(true);
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  function insertAsset(asset: Asset) {
    if (asset.kind === "image") {
      onInsert(`![${asset.name}](${asset.url})\n`);
    } else {
      onInsert(`[${asset.name}](${asset.url})\n`);
    }
  }

  async function removeAsset(id: string, name: string) {
    const ok = await confirm({
      title: "删除素材",
      description: `确认删除「${name}」？将移入回收站，30 天内可恢复。`,
      variant: "destructive",
    });
    if (!ok) return;
    const res = await fetch("/api/materials", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) setAssets((cur) => cur.filter((a) => a.id !== id));
  }

  function openEdit(asset: Asset) {
    setEditing(asset);
    setEditOpen(true);
  }

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="space-y-3 outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded-md"
    >
      {/* 上传区：点击 → 弹窗内选文件；拖拽 / 粘贴 → 弹窗立即上传 */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-md border border-dashed p-3 text-center transition-colors cursor-pointer",
          dragOver
            ? "border-primary bg-accent"
            : "border-input hover:bg-accent/50"
        )}
        onClick={openUploadByClick}
      >
        <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
        <p className="text-xs text-muted-foreground">
          拖拽文件 / {pasteShortcutLabel()} 粘贴图片，或点击选择（支持多文件）
        </p>
        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
          名称自动生成，可在弹窗里填写描述 / 标签帮助 AI 插图
        </p>
      </div>

      {/* 已上传素材列表 */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">
          本文章素材（{assets.length}）
        </div>
        {loading ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            加载中…
          </div>
        ) : assets.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            暂无素材
          </div>
        ) : (
          assets.map((a) => {
            const tags = parseTags(a.tagsJson);
            return (
              <div
                key={a.id}
                className="rounded-md border border-border p-2"
              >
                <div className="flex items-center gap-2">
                  <div className="shrink-0">
                    {a.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.url}
                        alt={a.name}
                        className="h-8 w-8 rounded object-cover"
                      />
                    ) : a.kind === "video" ? (
                      <VideoIcon className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <FileIcon className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono truncate">{a.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {formatSize(a.size)}
                    </div>
                  </div>
                  <button
                    onClick={() => insertAsset(a)}
                    className="text-primary hover:underline text-xs shrink-0"
                    title="插入正文"
                  >
                    <Plus className="h-3.5 w-3.5 inline" />
                    插入
                  </button>
                  <button
                    onClick={() => copyUrl(a.url)}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    title="复制链接"
                  >
                    {copied === a.url ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => openEdit(a)}
                    className="text-muted-foreground hover:text-primary shrink-0"
                    title="编辑描述 / 标签"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeAsset(a.id, a.name)}
                    className="text-muted-foreground hover:text-red-600 shrink-0"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {/* 描述 / 标签（供 AI 插图判断） */}
                {(a.description || tags.length > 0) && (
                  <div className="mt-1.5 pl-10 space-y-1">
                    {a.description && (
                      <p className="text-[11px] text-muted-foreground line-clamp-2">
                        {a.description}
                      </p>
                    )}
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tags.map((t) => (
                          <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <UploadDialog
        ref={dialogRef}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        articleId={articleId}
        spaceId={spaceId}
        initialFiles={uploadInitial}
        onUploaded={() => {
          void refresh();
        }}
        onAllDone={() => {
          void refresh();
        }}
      />
      <AssetEditDialog
        asset={editing}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={(updated) => {
          setAssets((cur) => cur.map((a) => (a.id === updated.id ? updated : a)));
        }}
      />
      {dialog}
    </div>
  );
}
