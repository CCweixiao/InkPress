"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, ChevronRight, FolderOpen, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArticleCard, type ArticleListItem } from "@/components/articles/ArticleCard";
import { NewArticleButton } from "@/components/articles/NewArticleButton";
import { ImportArticleButton } from "@/components/articles/ImportArticleButton";
import { SpaceDialog, type SpaceForm } from "./SpaceDialog";
import type { ViewMode } from "@/components/common/ViewToggle";
import { cn } from "@/lib/utils";

/** 首页每空间默认展示数；更多内容在空间详情页统一管理。 */
const HOME_PAGE_SIZE = 4;

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
  // 首页默认收起，避免空间和文章很多时形成无限长列表。
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
    <section className="space-y-3 border-t border-border/60 pt-6 first:border-t-0 first:pt-0">
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
          <NewArticleButton spaceId={space.id} variant="ghost" size="sm" />
          {/* 从 ZIP 导入文章到当前空间 */}
          <ImportArticleButton spaceId={space.id} variant="ghost" size="sm" />
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
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
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
          <div className="flex items-center justify-center gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLimit((l) => Math.min(articles.length, l + HOME_PAGE_SIZE))}
            >
              <ChevronDown className="h-4 w-4" />
              展开更多（还有 {articles.length - limit} 篇）
            </Button>
            <Link href={`/spaces/${space.id}`} className="text-xs text-primary hover:underline">查看空间全部文章</Link>
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
