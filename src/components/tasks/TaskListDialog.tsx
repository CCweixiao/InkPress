"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Check,
  ListPlus,
  FolderOpen,
  AlertTriangle,
  X,
  Smile,
  List,
  LayoutGrid,
  CalendarDays,
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
  list?: { id: string; name: string; color: string; folderId: string | null; viewMode?: "list" | "kanban" | "calendar"; groupMode?: "status" | "week" | "custom" } | null;
}

export function TaskListDialog({ open, onOpenChange, folderId, folders = [], onSaved, list }: TaskListDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PRESET_COLORS[0]);
  const [emoji, setEmoji] = useState<string>(DEFAULT_LIST_EMOJI);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "kanban" | "calendar">("list");
  const [groupMode, setGroupMode] = useState<"status" | "week" | "custom">("status");

  useEffect(() => {
    if (open) {
      setName(list?.name ?? "");
      setColor(list?.color ?? PRESET_COLORS[0]);
      setEmoji(list ? getListEmoji(list.id) : DEFAULT_LIST_EMOJI);
      setSelectedFolderId(list?.folderId ?? folderId ?? null);
      setConfirmDelete(false);
      setShowEmojiPicker(false);
      setSaving(false);
      setViewMode(list?.viewMode ?? "list");
      setGroupMode(list?.groupMode === "custom" ? "custom" : "status");
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
          body: JSON.stringify({ name: name.trim(), color, folderId: selectedFolderId, viewMode, groupMode }),
        });
        if (res.ok) setListEmoji(list.id, emoji);
      } else {
        const res = await fetch("/api/tasks/lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), color, folderId: selectedFolderId, viewMode, groupMode }),
        });
        if (res.ok) {
          const data = await res.json();
          const newId = data?.list?.id as string | undefined;
          if (newId) setListEmoji(newId, emoji);
        }
      }
      onSaved();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }, [name, saving, list, color, selectedFolderId, emoji, viewMode, groupMode, onSaved, onOpenChange]);

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
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[600px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-hidden bg-card border border-border rounded-2xl shadow-2xl animate-in fade-in slide-in-from-top-2 flex flex-col">
        {/* ===== Header ===== */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border shrink-0">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 text-base"
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
          <div className="flex-1 px-5 py-4 space-y-3.5 min-w-0">
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
                    "flex items-center justify-center w-9 h-9 rounded-lg border text-base transition-all shrink-0",
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
                  maxLength={10}
                  placeholder="例如：工作、生活、学习计划"
                  className="h-9 flex-1 min-w-0 px-3 bg-muted border border-transparent rounded-lg text-sm outline-none transition-all focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/60"
                />
              </div>
            </div>

            {/* emoji 选择器（展开式） */}
            {showEmojiPicker && (
              <div className="rounded-lg border border-border bg-muted/40 p-2 animate-in fade-in">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                  <Smile className="h-3.5 w-3.5" />
                  选择图标
                </div>
                <div className="grid grid-cols-9 gap-1">
                  <button
                    onClick={() => { setEmoji(DEFAULT_LIST_EMOJI); }}
                    className={cn(
                      "flex items-center justify-center w-7 h-7 rounded-md text-sm transition-all hover:bg-accent",
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
                        "flex items-center justify-center w-7 h-7 rounded-md text-sm transition-all hover:bg-accent",
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
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={cn(
                      "relative h-7 w-7 rounded-md transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md",
                      color === c && "scale-105"
                    )}
                    style={{
                      backgroundColor: c,
                      boxShadow: color === c ? `0 0 0 2px var(--background), 0 0 0 3px ${c}` : "none",
                    }}
                    title={c}
                  >
                    {color === c && (
                      <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* 所属文件夹 */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2"><span className="w-1 h-1 rounded-full bg-primary" />默认视图</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: "list" as const, label: "列表", icon: List },
                  { value: "kanban" as const, label: "看板", icon: LayoutGrid },
                  { value: "calendar" as const, label: "日历", icon: CalendarDays },
                ]).map(({ value, label, icon: Icon }) => (
                  <button key={value} onClick={() => setViewMode(value)} className={cn("flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs transition-all", viewMode === value ? "border-primary bg-primary/5 text-primary shadow-sm" : "border-border text-muted-foreground hover:bg-accent")}>
                    <Icon className="h-3.5 w-3.5" />{label}
                  </button>
                ))}
              </div>
              {viewMode === "kanban" && (
                <select value={groupMode} onChange={(e) => setGroupMode(e.target.value as typeof groupMode)} className="mt-2 h-8 w-full rounded-lg bg-muted px-3 text-xs outline-none">
                  <option value="status">按状态分组</option><option value="custom">自定义横向分组</option>
                </select>
              )}
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
                    className="h-9 w-full pl-8 pr-3 bg-muted border border-transparent rounded-lg text-sm outline-none transition-all appearance-none focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/10 cursor-pointer"
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
          <div className="w-[220px] shrink-0 border-l border-border bg-muted/20 p-4 hidden sm:block">
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

              {/* 当前视图实时预览 */}
              <div
                className="rounded-xl p-3 mt-3 transition-all"
                style={{
                  background: `linear-gradient(135deg, ${color}14, ${color}05)`,
                  border: `1px solid ${color}30`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">{emoji}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color }}>
                      {previewName}
                    </p>
                    <p className="text-[9px] text-muted-foreground">{viewMode === "list" ? "列表视图" : viewMode === "kanban" ? "看板视图" : "日历视图"}</p>
                  </div>
                </div>
                {viewMode === "list" && (
                  <div className="space-y-2">
                    {["100%", "76%", "55%"].map((width, index) => <div key={width} className="flex items-center gap-2 rounded-md bg-background/70 px-2 py-1.5"><span className="h-2.5 w-2.5 rounded-full border" style={{ borderColor: color, backgroundColor: index === 2 ? color : "transparent" }} /><span className="h-1.5 rounded-full" style={{ width, backgroundColor: color + (index === 2 ? "45" : "2b") }} /></div>)}
                  </div>
                )}
                {viewMode === "kanban" && (
                  <div className="grid grid-cols-2 gap-2">
                    {[0, 1].map((column) => <div key={column} className="rounded-lg bg-background/65 p-1.5"><div className="mb-1.5 flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: column === 0 ? color : color + "70" }} /><span className="h-1 w-8 rounded-full" style={{ backgroundColor: color + "30" }} /></div>{Array.from({ length: column === 0 ? 2 : 1 }).map((_, card) => <div key={card} className="mb-1.5 rounded border bg-background p-1.5" style={{ borderColor: color + "25" }}><div className="h-1.5 w-full rounded-full" style={{ backgroundColor: color + "38" }} /><div className="mt-1 h-1 w-1/2 rounded-full bg-muted" /></div>)}</div>)}
                  </div>
                )}
                {viewMode === "calendar" && (
                  <div className="rounded-lg bg-background/70 p-2"><div className="mb-2 flex items-center justify-between"><span className="text-[9px] font-medium">本月</span><CalendarDays className="h-3 w-3" style={{ color }} /></div><div className="grid grid-cols-7 gap-1">{Array.from({ length: 28 }).map((_, day) => <span key={day} className={cn("flex aspect-square items-center justify-center rounded-sm text-[6px] text-muted-foreground", [4, 12, 20].includes(day) && "text-white")} style={[4, 12, 20].includes(day) ? { backgroundColor: color } : undefined}>{day + 1}</span>)}</div></div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ===== Footer ===== */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/30 shrink-0">
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
              className="h-8 px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg transition-colors font-medium"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="h-8 px-3 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium shadow-sm flex items-center gap-1.5"
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
