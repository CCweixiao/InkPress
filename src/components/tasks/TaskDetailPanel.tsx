"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, Check, FileText, Loader2, PanelRightClose, Save, Trash2 } from "lucide-react";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { cn } from "@/lib/utils";
import { PRIORITY_CONFIG, type Task, type TaskPriority } from "./types";
import { TagPicker } from "./TagPicker";

export function TaskDetailPanel({ task, onClose, onUpdate, onDelete }: {
  task: Task;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<Task> & { tagIds?: string[] }) => Promise<boolean> | void;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [content, setContent] = useState(task.content ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = title !== task.title || content !== (task.content ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(task.title);
    setContent(task.content ?? "");
    setSaved(false);
  }, [task.id, task.title, task.content]);

  const save = async () => {
    if (!title.trim() || !dirty) return;
    setSaving(true);
    await onUpdate(task.id, { title: title.trim(), content });
    setSaving(false);
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 1600);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

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
          <button onClick={save} disabled={!dirty || saving} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-40">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? "保存中" : saved ? "已保存" : "保存"}
          </button>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent" title="关闭详情"><PanelRightClose className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={save} className="mb-3 w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50" placeholder="任务标题" />
        <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-border pb-4">
          <select
            value={task.priority}
            onChange={(event) => onUpdate(task.id, { priority: Number(event.target.value) as TaskPriority })}
            className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground outline-none"
          >
            {Object.entries(PRIORITY_CONFIG).map(([value, config]) => <option key={value} value={value}>{config.label}优先级</option>)}
          </select>
          <TagPicker selectedIds={task.tags?.map((tag) => tag.id) ?? []} onChange={(tagIds) => onUpdate(task.id, { tagIds })} />
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><FileText className="h-3.5 w-3.5" /> Markdown 文档</span>
        </div>
        <div className="task-detail-editor min-h-[420px]" onBlur={() => { if (dirty) void save(); }}>
          <MarkdownEditor mode="task" value={content} onChange={setContent} placeholder="记录任务背景、执行步骤、会议纪要…支持 Markdown 和 / 命令" />
        </div>
      </div>

      <div className="flex shrink-0 items-center border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <span>更新于 {new Date(task.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        <button onClick={() => { onDelete(task.id); onClose(); }} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"><Trash2 className="h-3.5 w-3.5" />移到垃圾箱</button>
      </div>
    </aside>
  );
}
