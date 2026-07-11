"use client";

import { useState, useEffect, useRef } from "react";
import { Flag, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "./types";
import { PRIORITY_CONFIG } from "./types";
import { TagPicker } from "./TagPicker";

interface ListItem {
  id: string;
  name: string;
  color: string;
  folderName?: string;
}

interface QuickAddDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (data: {
    title: string;
    priority: TaskPriority;
    dueDate: string | null;
    tagIds: string[];
    listId: string;
  }) => Promise<boolean>;
  defaultListId?: string;
}

export function QuickAddDialog({ open, onClose, onAdd, defaultListId }: QuickAddDialogProps) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(0);
  const [dueDate, setDueDate] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [listId, setListId] = useState("");
  const [lists, setLists] = useState<ListItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch folders tree and flatten into list of lists
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tasks/folders");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const flattened: ListItem[] = [];
        // standalone lists (folderId=null)
        for (const l of data.standaloneLists ?? []) {
          flattened.push({ id: l.id, name: l.name, color: l.color });
        }
        // lists inside folders
        for (const f of data.folders ?? []) {
          for (const l of f.lists ?? []) {
            flattened.push({ id: l.id, name: l.name, color: l.color, folderName: f.name });
          }
        }
        setLists(flattened);
      } catch {
        // ignore fetch errors
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      // Set listId to defaultListId or first available list
      setListId(defaultListId ?? lists[0]?.id ?? "");
    } else {
      setTitle("");
      setPriority(0);
      setDueDate("");
      setTagIds([]);
      setListId("");
    }
  }, [open, defaultListId, lists]);

  // Global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        // Toggle if already open
        if (open) onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleSubmit = async () => {
    if (!title.trim() || !listId) return;
    setSubmitting(true);
    const success = await onAdd({
      title: title.trim(),
      priority,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      tagIds,
      listId,
    });
    setSubmitting(false);
    if (success) {
      setTitle("");
      setPriority(0);
      setDueDate("");
      setTagIds([]);
      setListId(defaultListId ?? lists[0]?.id ?? "");
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-full max-w-lg animate-in fade-in slide-in-from-top-2 duration-200">
        <div className="bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
          {/* Input */}
          <div className="p-4">
            <input
              ref={inputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入任务标题..."
              className="w-full text-lg bg-transparent border-none outline-none placeholder:text-muted-foreground/50"
              disabled={submitting}
            />
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 pb-3 border-t border-border pt-3">
            {/* List selector (required) */}
            <select
              value={listId}
              onChange={(e) => setListId(e.target.value)}
              className="text-xs bg-muted rounded-md px-2 py-1 border-none outline-none max-w-[140px]"
            >
              <option value="" disabled>选清单</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.folderName ? `${l.folderName} / ${l.name}` : l.name}
                </option>
              ))}
            </select>

            {/* Priority selector */}
            <div className="flex items-center gap-1">
              {([0, 1, 2, 3, 4] as TaskPriority[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={cn(
                    "h-7 w-7 rounded-md flex items-center justify-center text-xs transition-all",
                    priority === p
                      ? "bg-accent ring-1 ring-primary"
                      : "hover:bg-accent/50"
                  )}
                  title={PRIORITY_CONFIG[p].label}
                >
                  {p === 0 ? (
                    <Flag className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Flag className={cn("h-3.5 w-3.5 fill-current", PRIORITY_CONFIG[p].color)} />
                  )}
                </button>
              ))}
            </div>

            {/* Date picker */}
            <div className="flex items-center gap-1 ml-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="text-xs bg-transparent border-none outline-none text-muted-foreground"
              />
            </div>

            {/* Tag picker */}
            <div className="flex items-center gap-1 ml-2">
              <TagPicker selectedIds={tagIds} onChange={setTagIds} />
              {tagIds.length > 0 && (
                <span className="text-xs text-muted-foreground">{tagIds.length} 个标签</span>
              )}
            </div>

            <div className="flex-1" />

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!title.trim() || !listId || submitting}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                title.trim() && listId
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground"
              )}
            >
              添加
            </button>
          </div>

          {/* Hints */}
          <div className="px-4 py-2 bg-muted/30 text-xs text-muted-foreground flex items-center gap-3">
            <span><kbd className="px-1 bg-muted rounded">Enter</kbd> 添加</span>
            <span><kbd className="px-1 bg-muted rounded">Esc</kbd> 关闭</span>
            <span><kbd className="px-1 bg-muted rounded">⌘N</kbd> 快速添加</span>
          </div>
        </div>
      </div>
    </>
  );
}
