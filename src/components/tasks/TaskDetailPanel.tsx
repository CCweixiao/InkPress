"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Calendar, Check, ChevronRight, FileText, FolderOpen, Inbox, List, Loader2, PanelRightClose, Save, Trash2 } from "lucide-react";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { cn } from "@/lib/utils";
import { PRIORITY_CONFIG, type Task, type TaskPriority } from "./types";
import { TagPicker } from "./TagPicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type LocationList = { id: string; name: string; color: string; folderId: string | null };
type LocationFolder = { id: string; name: string; lists: LocationList[] };

export function TaskDetailPanel({ task, onClose, onUpdate, onDelete }: {
  task: Task;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<Task> & { tagIds?: string[] }) => boolean | void | Promise<boolean | void>;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [content, setContent] = useState(task.content ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [locationFolders, setLocationFolders] = useState<LocationFolder[]>([]);
  const [standaloneLists, setStandaloneLists] = useState<LocationList[]>([]);
  const [locationFolderId, setLocationFolderId] = useState<string | null>(task.list?.folderId ?? null);
  const [locationListId, setLocationListId] = useState<string | null>(task.listId);
  const [locationSectionId, setLocationSectionId] = useState<string | null>(task.sectionId ?? null);
  const [availableSections, setAvailableSections] = useState<{ id: string; name: string }[]>([]);
  const [virtualUngroupedName, setVirtualUngroupedName] = useState<string | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const isSubtask = Boolean(task.parentId);
  const dirty = title !== task.title || content !== (task.content ?? "");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 切换任务时重置本地编辑态；title/content 变化（如保存后 props 刷新）不重置 lastSavedAt
  useEffect(() => {
    setTitle(task.title);
    setContent(task.content ?? "");
    setPriority(task.priority);
    setLocationFolderId(task.list?.folderId ?? null);
    setLocationListId(task.listId);
    setLocationSectionId(task.sectionId ?? null);
    setSaved(false);
  }, [
    task.id,
    task.title,
    task.content,
    task.priority,
    task.listId,
    task.sectionId,
    task.list?.folderId,
  ]);

  useEffect(() => {
    fetch("/api/tasks/folders")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return;
        setLocationFolders(data.folders ?? []);
        setStandaloneLists(data.standaloneLists ?? []);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!locationListId) {
      setAvailableSections([]);
      setVirtualUngroupedName(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/tasks/lists/${locationListId}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled) return;
        setAvailableSections(data?.list?.sections ?? []);
        setVirtualUngroupedName(data?.list?.ungroupedVisible ? data?.list?.ungroupedName ?? "未分组" : null);
      })
      .catch(() => { if (!cancelled) { setAvailableSections([]); setVirtualUngroupedName(null); } });
    return () => { cancelled = true; };
  }, [locationListId]);

  const selectableLists = useMemo(
    () => locationFolderId === null
      ? standaloneLists
      : locationFolders.find((folder) => folder.id === locationFolderId)?.lists ?? [],
    [locationFolderId, locationFolders, standaloneLists]
  );

  // 仅在切换任务时清除「上次保存」时间戳
  useEffect(() => {
    setLastSavedAt(null);
  }, [task.id]);

  const save = async () => {
    if (!title.trim() || !dirty) return;
    // 取消待执行的自动保存（手动保存时避免重复请求）
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    setSaving(true);
    let updated: boolean | void;
    try {
      updated = await onUpdate(task.id, { title: title.trim(), content });
    } catch {
      setMetadataError("任务名称保存失败，请重试");
      return;
    } finally {
      setSaving(false);
    }
    if (updated === false) {
      setMetadataError("任务名称保存失败，请重试");
      return;
    }
    setSaved(true);
    setLastSavedAt(Date.now());
    setNow(Date.now());
    if (savedHintTimer.current) clearTimeout(savedHintTimer.current);
    savedHintTimer.current = setTimeout(() => setSaved(false), 1600);
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void save();
  };

  const updatePriority = async (nextPriority: TaskPriority) => {
    const previousPriority = priority;
    setPriority(nextPriority);
    setMetadataError(null);
    try {
      const updated = await onUpdate(task.id, { priority: nextPriority });
      if (updated === false) {
        setPriority(previousPriority);
        setMetadataError("优先级保存失败，请重试");
      }
    } catch {
      setPriority(previousPriority);
      setMetadataError("优先级保存失败，请重试");
    }
  };

  const updateTags = async (tagIds: string[]) => {
    setMetadataError(null);
    try {
      const updated = await onUpdate(task.id, { tagIds });
      if (updated === false) setMetadataError("标签保存失败，请重试");
      return updated;
    } catch {
      setMetadataError("标签保存失败，请重试");
      return false;
    }
  };

  const previewList = (nextListId: string) => {
    setLocationListId(nextListId);
    setLocationSectionId(null);
    setAvailableSections([]);
    setVirtualUngroupedName(null);
  };

  const previewFolder = (folderId: string | null) => {
    setLocationFolderId(folderId);
    setLocationListId(null);
    setLocationSectionId(null);
    setAvailableSections([]);
    setVirtualUngroupedName(null);
  };

  const moveToSection = async (nextSectionId: string | null) => {
    if (!locationListId) return;
    setLocationSectionId(nextSectionId);
    const updated = await onUpdate(task.id, { listId: locationListId, sectionId: nextSectionId });
    if (updated === false) {
      setLocationListId(task.listId);
      setLocationSectionId(task.sectionId ?? null);
    }
  };

  // 自适应刷新：60s 内每秒 tick（显示「n秒前」），之后每分钟 tick（显示「n分钟前」），超 1h 停止
  useEffect(() => {
    if (lastSavedAt === null) return;
    let stopped = false;
    let id: ReturnType<typeof setInterval>;
    const start = (interval: number) => {
      id = setInterval(() => {
        if (stopped) return;
        const elapsed = Date.now() - lastSavedAt;
        if (elapsed >= 60 * 60 * 1000) {
          // 超过 1 小时，不再需要刷新
          clearInterval(id);
          return;
        }
        setNow(Date.now());
      }, interval);
    };
    start(1000);
    return () => { stopped = true; clearInterval(id); };
  }, [lastSavedAt]);

  const elapsedText = (() => {
    if (lastSavedAt === null) return null;
    const secs = Math.floor((now - lastSavedAt) / 1000);
    if (secs < 1) return "刚刚保存";
    if (secs < 60) return `${secs}秒前保存`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}分钟前保存`;
    return null; // 超过1小时不再显示相对时间
  })();

  // 自动保存：标题或内容变更后 1.5s 静默提交
  useEffect(() => {
    if (!dirty || !title.trim()) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { void save(); }, 1500);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content]);

  useEffect(() => () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (savedHintTimer.current) clearTimeout(savedHintTimer.current);
  }, []);

  return (
    <aside className="flex h-full w-[min(42vw,620px)] min-w-[420px] flex-col border-l border-border bg-background shadow-[-12px_0_32px_rgba(15,23,42,0.06)] animate-in slide-in-from-right-4">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <button
          onClick={() => onUpdate(task.id, { status: task.status === "done" ? "todo" : "done" })}
          className={cn("flex h-6 w-6 items-center justify-center rounded-md border transition-colors", task.status === "done" ? "border-emerald-500 bg-emerald-500 text-white" : "border-border hover:border-primary")}
          title={task.status === "done" ? "恢复为待办" : "标记完成"}
        >
          {task.status === "done" && <Check className="h-4 w-4" />}
        </button>
        <span className="h-5 w-px bg-border" />
        <label className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
          <Calendar className="h-3.5 w-3.5" />
          <input
            type="date"
            value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
            onChange={(event) => onUpdate(task.id, { dueDate: event.target.value ? new Date(`${event.target.value}T12:00:00`).toISOString() : null })}
            className="bg-transparent outline-none"
          />
        </label>
        <div className="ml-auto flex items-center gap-1">
          {elapsedText && !saving && (
            <span className="text-[11px] text-muted-foreground/60 dark:text-muted-foreground/50 select-none tabular-nums">
              {elapsedText}
            </span>
          )}
          <button onClick={save} disabled={!dirty || saving} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-40">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? "保存中" : saved ? "已保存" : "保存"}
          </button>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent" title="关闭详情"><PanelRightClose className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={handleTitleKeyDown} onBlur={() => void save()} maxLength={50} className="mb-3 w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50" placeholder="任务标题" />
        <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-border pb-4">
          <select
            value={priority}
            onChange={(event) => void updatePriority(Number(event.target.value) as TaskPriority)}
            disabled={isSubtask}
            className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={isSubtask ? "子任务继承父任务优先级" : "任务优先级"}
            title={isSubtask ? "子任务继承最父级任务的优先级" : undefined}
          >
            {Object.entries(PRIORITY_CONFIG).map(([value, config]) => <option key={value} value={value}>{config.label}优先级</option>)}
          </select>
          <TagPicker selectedIds={task.tags?.map((tag) => tag.id) ?? []} onChange={updateTags} disabled={isSubtask} />
          {/* 已选标签 chips */}
          {task.tags?.map((tag) => (
            <span
              key={tag.id}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: tag.color + "1a", color: tag.color }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
              {tag.name}
              {!isSubtask && <button
                  onClick={() => void updateTags((task.tags?.map((t) => t.id) ?? []).filter((id) => id !== tag.id))}
                  className="ml-0.5 hover:opacity-70 transition-opacity"
                  title="移除标签"
                >
                  ×
                </button>}
            </span>
          ))}
          {isSubtask && <span className="text-[11px] text-muted-foreground">继承最父级任务的优先级和标签</span>}
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><FileText className="h-3.5 w-3.5" /> Markdown 文档</span>
          {metadataError && <span className="w-full text-xs text-red-500">{metadataError}</span>}
        </div>
        <div className="task-detail-editor min-h-[420px]" onBlur={() => { if (dirty) void save(); }}>
          <MarkdownEditor mode="task" value={content} onChange={setContent} placeholder="记录任务背景、执行步骤、会议纪要…支持 Markdown 和 / 命令" />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <Popover open={locationPickerOpen} onOpenChange={setLocationPickerOpen}>
          <PopoverTrigger asChild>
            <button disabled={isSubtask} className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60" title={isSubtask ? "子任务继承父任务归属" : "切换任务归属"}>
              {task.list?.name === "收集箱" ? <Inbox className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" /> : <FolderOpen className="h-3.5 w-3.5 shrink-0" />}
              <span className="max-w-28 truncate">{task.list?.name ?? "收集箱"}</span>
              {locationSectionId && <><ChevronRight className="h-3 w-3 shrink-0" /><span className="max-w-20 truncate">{availableSections.find((section) => section.id === locationSectionId)?.name ?? "分组"}</span></>}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-[min(620px,calc(100vw-3rem))] p-2">
            <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border/70 bg-background text-sm">
              <div className="border-r border-border/70 p-1.5">
                <p className="px-2 py-1 text-[11px] text-muted-foreground">位置</p>
                {standaloneLists.map((list) => <button key={list.id} onClick={() => { previewFolder(null); previewList(list.id); }} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left", locationListId === list.id ? "bg-primary/10 text-primary" : "hover:bg-accent")}><Inbox className="h-3.5 w-3.5" /><span className="truncate">{list.name}</span></button>)}
                {locationFolders.map((folder) => <button key={folder.id} onClick={() => previewFolder(folder.id)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left", locationFolderId === folder.id ? "bg-muted font-medium" : "hover:bg-accent")}><FolderOpen className="h-3.5 w-3.5" /><span className="flex-1 truncate">{folder.name}</span><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></button>)}
              </div>
              <div className="border-r border-border/70 p-1.5">
                <p className="px-2 py-1 text-[11px] text-muted-foreground">清单</p>
                {selectableLists.length > 0 ? selectableLists.map((list) => <button key={list.id} onClick={() => previewList(list.id)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left", locationListId === list.id ? "bg-primary/10 text-primary" : "hover:bg-accent")}><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: list.color }} /><span className="truncate">{list.name}</span></button>) : <p className="px-2 py-3 text-xs text-muted-foreground">选择文件夹</p>}
              </div>
              <div className="p-1.5">
                <p className="px-2 py-1 text-[11px] text-muted-foreground">分组</p>
                {virtualUngroupedName && <button onClick={() => { void moveToSection(null); setLocationPickerOpen(false); }} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left", locationSectionId === null ? "bg-primary/10 text-primary" : "hover:bg-accent")}><List className="h-3.5 w-3.5" /><span className="truncate">{virtualUngroupedName}</span></button>}
                {availableSections.map((section) => <button key={section.id} onClick={() => { void moveToSection(section.id); setLocationPickerOpen(false); }} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left", locationSectionId === section.id ? "bg-primary/10 text-primary" : "hover:bg-accent")}><List className="h-3.5 w-3.5" /><span className="truncate">{section.name}</span></button>)}
                {!virtualUngroupedName && availableSections.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">该清单没有可选分组</p>}
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <span className="ml-auto whitespace-nowrap">更新于 {new Date(task.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        <button onClick={() => { onDelete(task.id); onClose(); }} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"><Trash2 className="h-3.5 w-3.5" />移到垃圾箱</button>
      </div>
    </aside>
  );
}
