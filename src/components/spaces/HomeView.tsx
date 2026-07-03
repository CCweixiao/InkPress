"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ViewToggle, useViewMode, type ViewMode } from "@/components/common/ViewToggle";
import { SpaceSection, type SpaceItem } from "./SpaceSection";
import { SpaceDialog } from "./SpaceDialog";
import { ArticleCard, type ArticleListItem } from "@/components/articles/ArticleCard";
import { ImportArticleButton } from "@/components/articles/ImportArticleButton";

/** 首页未分类区块默认显示数，「显示更多」递增量 */
const UNCLASSIFIED_PAGE_SIZE = 8;

/**
 * 首页主体（客户端）：视图切换 + 新建空间 + 空间分区 + 未分类文章。
 * 数据由服务端组件传入。
 */
export function HomeView({
  spaces,
  unclassified,
  initialViewMode,
}: {
  spaces: { space: SpaceItem; articles: ArticleListItem[] }[];
  unclassified: ArticleListItem[];
  initialViewMode?: ViewMode;
}) {
  const router = useRouter();
  const [view, setView] = useViewMode(initialViewMode);
  const [createOpen, setCreateOpen] = useState(false);
  // 未分类区块懒加载
  const [unclassifiedLimit, setUnclassifiedLimit] = useState(UNCLASSIFIED_PAGE_SIZE);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">我的文章</h1>
          <p className="text-sm text-muted-foreground mt-1">
            按空间分类管理文章 · AI 生成、实时预览、一键推送公众号草稿箱
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <FolderPlus className="h-4 w-4" />
            新建空间
          </Button>
        </div>
      </div>

      {spaces.length === 0 && unclassified.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-16 text-center">
          <p className="text-muted-foreground mb-4">
            还没有文章，新建一个空间或直接新建文章开始创作吧
          </p>
        </div>
      ) : (
        <>
          {spaces.map(({ space, articles }) => (
            <SpaceSection
              key={space.id}
              space={space}
              articles={articles}
              view={view}
            />
          ))}

          {unclassified.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-muted-foreground">
                  未分类
                </h2>
                <span className="text-xs text-muted-foreground">
                  {unclassified.length} 篇
                </span>
                <ImportArticleButton spaceId={null} variant="ghost" size="sm" />
              </div>
              <div
                className={
                  view === "grid"
                    ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                    : "flex flex-col gap-2"
                }
              >
                {unclassified.slice(0, unclassifiedLimit).map((article) => (
                  <ArticleCard key={article.id} article={article} view={view} />
                ))}
              </div>
              {unclassified.length > unclassifiedLimit && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setUnclassifiedLimit((l) => l + UNCLASSIFIED_PAGE_SIZE)
                    }
                  >
                    <ChevronDown className="h-4 w-4" />
                    显示更多（剩余 {unclassified.length - unclassifiedLimit} 篇）
                  </Button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      <SpaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
