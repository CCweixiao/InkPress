"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Check,
  ListPlus,
  FolderOpen,
  AlertTriangle,
  X,
  Smile,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LIST_EMOJI_PRESETS,
  DEFAULT_LIST_EMOJI,
  setListEmoji,
  getListEmoji,
} from "@/lib/tasks/list-icons";

const PRESET_COLORS = [
  "#6b7280", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#14b8a6", "#3b82f6", "#6366f1",
  "#8b5cf6", "#ec4899", "#f43f5e", "#0ea5e9",
] as const;

interface TaskListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId?: string | null;
  folders?: { id: string; name: string }[];
  onSaved: () => void;
  // 编辑模式（可选）
  list?: { id: string; name: string; color: string; folderId: string | null } | null;
}

export function TaskListDialog({ open, onOpenChange, folderId, folders = [], onSaved, list }: TaskListDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PRESET_COLORS[0]);
  const [emoji, setEmoji] = useState<string>(DEFAULT_LIST_EMOJI);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(list?.name ?? "");
      setColor(list?.color ?? PRESET_COLORS[0]);
      setEmoji(list ? getListEmoji(list.id) : DEFAULT_LIST_EMOJI);
      setSelectedFolderId(list?.folderId ?? folderId ?? null);
      setConfirmDelete(false);
      setShowEmojiPicker(false);
      setSaving(false);
    }
  }, [open, list, folderId]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onOpenChange]);

  const handleSave = useCallback(async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      if (list) {
        const res = await fetch(`/api/tasks/lists/${list.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), color, folderId: selectedFolderId }),
        });
        if (res.ok) setListEmoji(list.id, emoji === DEFAULT_LIST_EMOJI ? null : emoji);
      } else {
        const res = await fetch("/api/tasks/lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), color, folderId: selectedFolderId }),
        });
        if (res.ok) {
          const data = await res.json();
          const newId = data?.list?.id as string | undefined;
          if (newId && emoji !== DEFAULT_LIST_EMOJI) setListEmoji(newId, emoji);
        }
      }
      onSaved();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }, [name, saving, list, color, selectedFolderId, emoji, onSaved, onOpenChange]);

  const handleDelete = async () => {
    if (!list) return;
    await fetch(`/api/tasks/lists/${list.id}`, { method: "DELETE" });
    onSaved();
    onOpenChange(false);
  };

  if (!open) return null;

  const previewName = name.trim() || "清单名称";

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-50 animate-in fade-in"
        onClick={() => onOpenChange(false)}
      />

      {/* 对话框主体：左右分栏 */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[560px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-hidden bg-card border border-border rounded-2xl shadow-2xl animate-in fade-in slide-in-from-top-2 flex flex-col">
        {/* ===== Header ===== */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0 text-lg"
            style={{ backgroundColor: color + "1f" }}
          >
            <span>{emoji}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base leading-tight">
              {list ? "编辑清单" : "新建清单"}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {name.trim() ? `「${name.trim()}」` : "配置清单信息，右侧实时预览效果"}
            </p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ===== Body：左右分栏 ===== */}
        <div className="flex flex-1 min-h-0 overflow-y-auto">
          {/* ---- 左侧：表单区 ---- */}
          <div className="flex-1 px-5 py-4 space-y-4 min-w-0">
            {/* 名称 + emoji 入口 */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                <span className="w-1 h-1 rounded-full bg-primary" />
                清单名称
              </label>
              <div className="flex gap-2">
                {/* emoji 触发按钮 */}
                <button
                  onClick={() => setShowEmojiPicker((v) => !v)}
                  className={cn(
                    "flex items-center justify-center w-11 h-10 rounded-lg border text-lg transition-all shrink-0",
                    showEmojiPicker
                      ? "border-primary bg-primary/5 ring-2 ring-primary/10"
                      : "border-border bg-muted hover:bg-accent"
                  )}
                  title="选择图标"
                >
                  {emoji}
                </button>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                  }}
                  placeholder="例如：工作、生活、学习计划"
                  className="flex-1 min-w-0 px-3 py-2.5 bg-muted border border-transparent rounded-lg text-sm outline-none transition-all focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/60"
                />
              </div>
            </div>

            {/* emoji 选择器（展开式） */}
            {showEmojiPicker && (
              <div className="rounded-lg border border-border bg-muted/40 p-2.5 animate-in fade-in">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                  <Smile className="h-3.5 w-3.5" />
                  选择图标
                </div>
                <div className="grid grid-cols-8 gap-1">
                  <button
                    onClick={() => { setEmoji(DEFAULT_LIST_EMOJI); }}
                    className={cn(
                      "flex items-center justify-center w-8 h-8 rounded-md text-base transition-all hover:bg-accent",
                      emoji === DEFAULT_LIST_EMOJI && "bg-primary/10 ring-1 ring-primary"
                    )}
                    title="默认"
                  >
                    {DEFAULT_LIST_EMOJI}
                  </button>
                  {LIST_EMOJI_PRESETS.map((e) => (
                    <button
                      key={e}
                      onClick={() => { setEmoji(e); }}
                      className={cn(
                        "flex items-center justify-center w-8 h-8 rounded-md text-base transition-all hover:bg-accent",
                        emoji === e && "bg-primary/10 ring-1 ring-primary"
                      )}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 颜色 */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                <span className="w-1 h-1 rounded-full bg-primary" />
                颜色
              </label>
              <div className="grid grid-cols-6 gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={cn(
                      "relative w-full aspect-square rounded-lg transition-all duration-150 hover:scale-110",
                      color === c && "scale-105"
                    )}
                    style={{
                      backgroundColor: c,
                      boxShadow: color === c ? `0 0 0 2px var(--background), 0 0 0 4px ${c}` : "none",
                    }}
                    title={c}
                  >
                    {color === c && (
                      <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* 所属文件夹 */}
            {folders.length > 0 && (
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                  <span className="w-1 h-1 rounded-full bg-primary" />
                  所属文件夹
                </label>
                <div className="relative">
                  <FolderOpen className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <select
                    value={selectedFolderId ?? ""}
                    onChange={(e) => setSelectedFolderId(e.target.value || null)}
                    className="w-full pl-8 pr-3 py-2.5 bg-muted border border-transparent rounded-lg text-sm outline-none transition-all appearance-none focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/10 cursor-pointer"
                  >
                    <option value="">（顶层独立清单）</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* 删除确认 */}
            {list && confirmDelete && (
              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 animate-in fade-in">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-300 flex-1">
                  删除「{list.name}」？其下任务将移入垃圾箱。
                </p>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleDelete}
                    className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 font-medium"
                  >
                    确认删除
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ---- 右侧：实时预览区 ---- */}
          <div className="w-[200px] shrink-0 border-l border-border bg-muted/20 p-4 hidden sm:block">
            <p className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-primary" />
              实时预览
            </p>

            {/* 预览卡片（模拟侧边栏清单行的外观） */}
            <div className="space-y-2">
              <div
                className={cn(
                  "flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-all",
                  "bg-background border-border shadow-sm"
                )}
              >
                <span
                  className="flex items-center justify-center w-6 h-6 rounded-md text-sm shrink-0"
                  style={{ backgroundColor: color + "1f" }}
                >
                  {emoji}
                </span>
                <span className="flex-1 text-sm font-medium truncate" style={{ color }}>
                  {previewName}
                </span>
                <span
                  className="text-[10px] rounded-full px-1.5 leading-5 shrink-0"
                  style={{ backgroundColor: color + "1f", color }}
                >
                  0
                </span>
              </div>

              {/* 色块大图预览 */}
              <div
                className="rounded-xl p-4 mt-3 transition-all"
                style={{
                  background: `linear-gradient(135deg, ${color}14, ${color}05)`,
                  border: `1px solid ${color}30`,
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{emoji}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color }}>
                      {previewName}
                    </p>
                    <p className="text-[10px] text-muted-foreground">任务清单</p>
                  </div>
                </div>
                {/* 模拟任务条 */}
                <div className="space-y-1.5 mt-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full border-2" style={{ borderColor: color + "60" }} />
                    <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: color + "30" }} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full border-2" style={{ borderColor: color + "60" }} />
                    <span className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: color + "25" }} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                    <span className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: color + "30" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ===== Footer ===== */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-muted/30 shrink-0">
          {list ? (
            confirmDelete ? (
              <span className="text-xs text-muted-foreground">请确认删除操作</span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 px-2 py-1 rounded transition-colors font-medium"
              >
                删除清单
              </button>
            )
          ) : (
            <span className="text-xs text-muted-foreground">
              按 <kbd className="px-1 py-0.5 bg-muted rounded text-[10px] border border-border">Enter</kbd> 快速创建
            </span>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg transition-colors font-medium"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium shadow-sm flex items-center gap-1.5"
            >
              {saving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                  保存中
                </>
              ) : list ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  保存
                </>
              ) : (
                <>
                  <ListPlus className="h-3.5 w-3.5" />
                  创建清单
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
