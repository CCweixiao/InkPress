"use client";

import { useState, useEffect, useCallback } from "react";
import { ListChecks, FolderOpen, Trash2, Tag as TagIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TagManageDialog } from "./TagManageDialog";

export type SelectedKey =
  | { type: "all" }
  | { type: "folder"; id: string }
  | { type: "list"; id: string }
  | { type: "trash" };

interface SpaceItem {
  id: string;
  name: string;
}

type Counts = {
  total: number;
  byList: Record<string, number>;
  trashed: number;
};

interface TaskSidebarProps {
  selected: SelectedKey;
  onSelect: (key: SelectedKey) => void;
  refreshKey?: number;
}

export function TaskSidebar({ selected, onSelect, refreshKey }: TaskSidebarProps) {
  const [spaces, setSpaces] = useState<SpaceItem[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, byList: {}, trashed: 0 });
  const [tagOpen, setTagOpen] = useState(false);

  const load = useCallback(async () => {
    const [spaceRes, countRes] = await Promise.all([
      fetch("/api/spaces"),
      fetch("/api/tasks/counts"),
    ]);
    if (spaceRes.ok) {
      const data = await spaceRes.json();
      setSpaces(data.spaces ?? []);
    }
    if (countRes.ok) {
      setCounts(await countRes.json());
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const Row = ({
    icon: Icon,
    label,
    count,
    active,
    onClick,
  }: {
    icon: React.ElementType;
    label: string;
    count?: number;
    active: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={cn("text-xs shrink-0", active ? "opacity-80" : "text-muted-foreground")}>
          {count}
        </span>
      )}
    </button>
  );

  return (
    <aside className="w-60 shrink-0 border-r border-border flex flex-col gap-1 p-3 h-full">
      <Row
        icon={ListChecks}
        label="全部任务"
        count={counts.total}
        active={selected.type === "all"}
        onClick={() => onSelect({ type: "all" })}
      />

      <div className="h-px bg-border my-1" />

      <div className="flex items-center justify-between px-2">
        <span className="text-xs text-muted-foreground">清单</span>
      </div>
      {spaces.length === 0 ? (
        <p className="text-xs text-muted-foreground px-2 py-1">暂无清单</p>
      ) : (
        spaces.map((space) => (
          <Row
            key={space.id}
            icon={FolderOpen}
            label={space.name}
            count={counts.byList[space.id]}
            active={selected.type === "list" && selected.id === space.id}
            onClick={() => onSelect({ type: "list", id: space.id })}
          />
        ))
      )}

      <div className="h-px bg-border my-1" />

      <Row
        icon={Trash2}
        label="垃圾箱"
        count={counts.trashed}
        active={selected.type === "trash"}
        onClick={() => onSelect({ type: "trash" })}
      />

      <div className="flex-1" />

      <button
        onClick={() => setTagOpen(true)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <TagIcon className="h-4 w-4 shrink-0" />
        标签管理
      </button>

      <TagManageDialog open={tagOpen} onOpenChange={setTagOpen} />
    </aside>
  );
}
