"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ViewToggle, type ViewMode } from "@/components/common/ViewToggle";
import { ArticleCard, type ArticleListItem } from "@/components/articles/ArticleCard";
import { SpaceDialog, type SpaceForm } from "./SpaceDialog";
import { cn } from "@/lib/utils";

type Space = {
  id: string;
  name: string;
  description: string;
  tagsJson: string;
  isDefault?: boolean;
  pinned?: boolean;
};

/** 空间页分页：每页 16 条 */
const PAGE_SIZE = 16;

function parseTags(tagsJson: string): string[] {
  try {
    const t = JSON.parse(tagsJson);
    return Array.isArray(t) ? t.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 空间详情主体：标题/描述/标签 + 编辑/删除 + 文章列表（网格/列表视图 + 分页） */
export function SpaceDetail({
  space,
  articles,
}: {
  space: Space;
  articles: ArticleListItem[];
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("grid");
  const [editOpen, setEditOpen] = useState(false);
  const [page, setPage] = useState(1);
  const tags = parseTags(space.tagsJson);

  const totalPages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = articles.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  async function handleDelete() {
    if (articles.length > 0) {
      window.alert(`该空间下还有 ${articles.length} 篇文章，请先删除或移出这些文章后再删除空间。`);
      return;
    }
    if (!window.confirm(`确定删除空间「${space.name}」？`)) return;
    const res = await fetch(`/api/spaces/${space.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || "删除失败");
      return;
    }
    router.push("/");
  }

  const form: SpaceForm = {
    id: space.id,
    name: space.name,
    description: space.description,
    tags,
    pinned: space.pinned,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{space.name}</h1>
            {space.isDefault && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent text-accent-foreground">
                默认
              </span>
            )}
            {!space.isDefault && space.pinned && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                置顶
              </span>
            )}
          </div>
          {space.description && (
            <p className="text-sm text-muted-foreground mt-1">
              {space.description}
            </p>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {tags.map((t) => (
                <span
                  key={t}
                  className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ViewToggle value={view} onChange={setView} />
          {/* 默认空间不可编辑/删除 */}
          {!space.isDefault && (
            <>
              <button
                onClick={() => setEditOpen(true)}
                className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent border border-border"
                title="编辑空间"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={handleDelete}
                className="p-2 text-muted-foreground hover:text-red-600 rounded-md hover:bg-accent border border-border"
                title="删除空间"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {articles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-16 text-center">
          <p className="text-muted-foreground mb-4">空间内还没有文章</p>
          <Button onClick={() => router.refresh()}>刷新</Button>
        </div>
      ) : (
        <>
          <div
            className={cn(
              view === "grid"
                ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                : "flex flex-col gap-2"
            )}
          >
            {paged.map((article) => (
              <ArticleCard key={article.id} article={article} view={view} />
            ))}
          </div>

          {/* 分页控件 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {safePage} / {totalPages} 页（共 {articles.length} 篇）
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      <SpaceDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={form}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
