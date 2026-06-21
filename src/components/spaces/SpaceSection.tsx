"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, ChevronRight, FolderOpen, Plus, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArticleCard, type ArticleListItem } from "@/components/articles/ArticleCard";
import { NewArticleButton } from "@/components/articles/NewArticleButton";
import { SpaceDialog, type SpaceForm } from "./SpaceDialog";
import type { ViewMode } from "@/components/common/ViewToggle";
import { cn } from "@/lib/utils";

/** 首页每空间默认显示文章数，「显示更多」每次递增量 */
const HOME_PAGE_SIZE = 8;

export type SpaceItem = {
  id: string;
  name: string;
  description: string;
  tagsJson: string;
  _count?: { articles: number };
  isDefault?: boolean;
  pinned?: boolean;
};

function parseTags(tagsJson: string): string[] {
  try {
    const t = JSON.parse(tagsJson);
    return Array.isArray(t) ? t.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 首页/空间页用的「空间区块」：标题 + 标签 + 文章网格 */
export function SpaceSection({
  space,
  articles,
  view,
}: {
  space: SpaceItem;
  articles: ArticleListItem[];
  view: ViewMode;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  // 首页懒加载：默认显示 HOME_PAGE_SIZE 篇，「显示更多」每次 +HOME_PAGE_SIZE
  const [limit, setLimit] = useState(HOME_PAGE_SIZE);
  const tags = parseTags(space.tagsJson);

  async function handleDelete() {
    if (!window.confirm(`确定删除空间「${space.name}」？`)) return;
    const res = await fetch(`/api/spaces/${space.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || "删除失败");
      return;
    }
    router.refresh();
  }

  const form: SpaceForm = {
    id: space.id,
    name: space.name,
    description: space.description,
    tags,
    pinned: space.pinned,
  };

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/spaces/${space.id}`}
          className="flex items-center gap-2 min-w-0 group"
        >
          <FolderOpen className="h-5 w-5 text-primary shrink-0" />
          <h2 className="text-lg font-semibold group-hover:text-primary transition-colors truncate">
            {space.name}
          </h2>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground shrink-0">
            {space._count?.articles ?? articles.length} 篇
          </span>
        </Link>
        <div className="flex items-center gap-1 shrink-0">
          {/* 新建文章：归属到当前空间（位于编辑按钮前） */}
          <NewArticleButton spaceId={space.id} variant="ghost" size="sm" />
          {/* 默认空间不可编辑/删除 */}
          {!space.isDefault && (
            <>
              <button
                onClick={() => setEditOpen(true)}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent"
                title="编辑空间"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleDelete}
                className="p-1.5 text-muted-foreground hover:text-red-600 rounded-md hover:bg-accent"
                title="删除空间"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {space.isDefault && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent text-accent-foreground shrink-0">
              默认
            </span>
          )}
          {!space.isDefault && space.pinned && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
              置顶
            </span>
          )}
        </div>
      </div>

      {(space.description || tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {space.description && (
            <span className="text-xs text-muted-foreground">
              {space.description}
            </span>
          )}
          {tags.map((t) => (
            <span
              key={t}
              className="text-[11px] px-2 py-0.5 rounded-full bg-accent text-accent-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {articles.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          空间内暂无文章
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
          {articles.slice(0, limit).map((article) => (
            <ArticleCard key={article.id} article={article} view={view} />
          ))}
        </div>
        {/* 显示更多：剩余文章数 > 0 时展示 */}
        {articles.length > limit && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLimit((l) => l + HOME_PAGE_SIZE)}
            >
              <ChevronDown className="h-4 w-4" />
              显示更多（剩余 {articles.length - limit} 篇）
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
    </section>
  );
}
