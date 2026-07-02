"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Upload,
  Copy,
  Check,
  Trash2,
  ImageIcon,
  VideoIcon,
  FileIcon,
  FolderOpen,
  FileText,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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

type Space = { id: string; name: string };
type Article = { id: string; title: string; spaceId: string | null };

function formatSize(bytes: number) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 素材浏览器：左空间列表 + 中文章列表 + 右素材网格。
 * 按「空间 → 文章」目录组织，文章删除时其素材随之软删（由 API 层保证）。
 */
export function MaterialBrowser({
  spaces,
  articles,
  ossConfigured,
}: {
  spaces: Space[];
  articles: Article[];
  ossConfigured: boolean;
}) {
  const [selectedSpace, setSelectedSpace] = useState<string | null>(null); // null = 未分类
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null); // null = 空间级/全部
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  // 上传弹窗：uploadInitial=null 表示点击进入；非空表示拖拽/粘贴进入（立即上传）
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadInitial, setUploadInitial] = useState<File[] | null>(null);
  const dialogRef = useRef<UploadDialogHandle>(null);
  // 素材编辑弹窗
  const [editing, setEditing] = useState<Asset | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const { confirm, dialog } = useConfirm();

  /** 粘贴图片：弹窗开→追加；关→用文件打开弹窗（live 模式立即上传）。 */
  const handlePastedFiles = useCallback(
    (files: File[]) => {
      if (uploadOpen) {
        dialogRef.current?.addFiles(files);
        return;
      }
      setUploadInitial(files);
      setUploadOpen(true);
    },
    [uploadOpen]
  );

  // document-scope：整页粘贴图片都进上传弹窗。弹窗打开时禁用（弹窗内部监听器独占）。
  useClipboardImagePaste(null, {
    enabled: ossConfigured && !uploadOpen,
    scope: "document",
    onPaste: handlePastedFiles,
  });

  const spaceArticles = articles.filter(
    (a) => a.spaceId === selectedSpace
  );

  async function loadAssets() {
    setLoading(true);
    let url = "/api/materials?";
    if (selectedArticle) {
      url += `articleId=${selectedArticle}`;
    } else if (selectedSpace) {
      url += `spaceId=${selectedSpace}`;
    } else {
      // 未分类：无空间归属
      url += `spaceId=none`;
    }
    const res = await fetch(url);
    const data = await res.json();
    setAssets(data.assets ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSpace, selectedArticle]);

  function selectSpace(id: string | null) {
    setSelectedSpace(id);
    setSelectedArticle(null);
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  async function remove(id: string, name: string) {
    const ok = await confirm({
      title: "删除素材",
      description: `确认删除「${name}」？将移入回收站，30 天内可恢复。`,
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await fetch("/api/materials", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) setAssets((cur) => cur.filter((a) => a.id !== id));
    });
  }

  /** 拖拽文件到素材区：打开弹窗立即上传（与粘贴同走 live 模式）。 */
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) {
      setUploadInitial(Array.from(e.dataTransfer.files));
      setUploadOpen(true);
    }
  }

  function openUploadByClick() {
    setUploadInitial(null);
    setUploadOpen(true);
  }

  const scopeLabel = selectedArticle
    ? articles.find((a) => a.id === selectedArticle)?.title ?? "文章素材"
    : selectedSpace
      ? `${spaces.find((s) => s.id === selectedSpace)?.name ?? "空间"} · 空间级素材`
      : "未分类素材";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_240px_1fr] gap-4">
      {/* 左：空间列表 */}
      <div className="space-y-1">
        <div className="text-xs font-semibold text-muted-foreground px-2 mb-1">
          空间
        </div>
        <SpaceRow
          icon={<FolderOpen className="h-4 w-4" />}
          name="未分类"
          active={selectedSpace === null}
          onClick={() => selectSpace(null)}
        />
        {spaces.map((s) => (
          <SpaceRow
            key={s.id}
            icon={<FolderOpen className="h-4 w-4" />}
            name={s.name}
            active={selectedSpace === s.id}
            onClick={() => selectSpace(s.id)}
          />
        ))}
      </div>

      {/* 中：文章列表 */}
      <div className="space-y-1">
        <div className="text-xs font-semibold text-muted-foreground px-2 mb-1">
          {selectedSpace ? "文章" : "全部文章"}
        </div>
        <button
          onClick={() => setSelectedArticle(null)}
          className={cn(
            "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors",
            selectedArticle === null
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          )}
        >
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">空间级 / 全部</span>
        </button>
        {spaceArticles.length === 0 ? (
          <div className="text-xs text-muted-foreground px-2 py-2">
            该范围无文章
          </div>
        ) : (
          spaceArticles.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedArticle(a.id)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors",
                selectedArticle === a.id
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              )}
            >
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">{a.title || "无标题文章"}</span>
            </button>
          ))
        )}
      </div>

      {/* 右：素材网格（支持拖拽 / 粘贴上传） */}
      <div
        className={cn(
          "space-y-4 rounded-lg transition-colors",
          dragOver && "ring-2 ring-primary/40 bg-accent/30"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">{scopeLabel}</div>
          <Button
            size="sm"
            disabled={!ossConfigured}
            onClick={openUploadByClick}
          >
            <Upload className="h-4 w-4" />
            上传
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground py-12 text-center">
            加载中…
          </div>
        ) : assets.length === 0 ? (
          <Card className="border-dashed">
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <FolderOpen className="h-10 w-10 mb-2 opacity-40" />
              <p className="text-sm">暂无素材</p>
              {ossConfigured && (
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  直接 {pasteShortcutLabel()} 粘贴图片，或拖拽 / 点击「上传」
                </p>
              )}
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {assets.map((asset) => (
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
                    <VideoIcon className="h-8 w-8 text-muted-foreground/50" />
                  ) : (
                    <FileIcon className="h-8 w-8 text-muted-foreground/50" />
                  )}
                </div>
                <div className="p-2 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <ImageIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span
                      className="text-xs font-mono truncate flex-1"
                      title={asset.name}
                    >
                      {asset.name}
                    </span>
                  </div>
                  {(asset.description || parseTags(asset.tagsJson).length > 0) && (
                    <div className="space-y-1">
                      {asset.description && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2">
                          {asset.description}
                        </p>
                      )}
                      {parseTags(asset.tagsJson).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {parseTags(asset.tagsJson).map((t) => (
                            <Badge
                              key={t}
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0"
                            >
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{formatSize(asset.size)}</span>
                  </div>
                  <div className="flex items-center gap-1">
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
                          <Copy className="h-3 w-3" /> 复制
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      onClick={() => {
                        setEditing(asset);
                        setEditOpen(true);
                      }}
                      title="编辑描述 / 标签"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                      onClick={() => remove(asset.id, asset.name)}
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

      <AssetEditDialog
        asset={editing}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={(updated) => {
          setAssets((cur) => cur.map((a) => (a.id === updated.id ? updated : a)));
        }}
      />
      <UploadDialog
        ref={dialogRef}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        articleId={selectedArticle ?? undefined}
        spaceId={selectedArticle ? undefined : selectedSpace ?? undefined}
        initialFiles={uploadInitial}
        onUploaded={() => {
          void loadAssets();
        }}
        onAllDone={() => {
          void loadAssets();
        }}
      />
      {dialog}
    </div>
  );
}

function SpaceRow({
  icon,
  name,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      )}
    >
      {icon}
      <span className="truncate">{name}</span>
    </button>
  );
}
