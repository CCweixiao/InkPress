"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, STATUS_LABEL } from "@/lib/utils";
import type { ViewMode } from "@/components/common/ViewToggle";

export type ArticleListItem = {
  id: string;
  title: string;
  contentMd: string; // 列表页传入的是摘要 snippet
  digest?: string | null;
  status: string;
  theme?: { name: string } | null;
  coverUrl?: string | null; // OSS 封面 URL，无则用占位
  updatedAt: string;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success"> = {
  draft: "secondary",
  ready: "default",
  pushed: "success",
};

const PLACEHOLDER_COVER = "/covers/placeholder.svg";

export function ArticleCard({
  article,
  view = "grid",
}: {
  article: ArticleListItem;
  view?: ViewMode;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`确定删除「${article.title || "无标题文章"}」？`)) return;
    setDeleting(true);
    const res = await fetch(`/api/articles/${article.id}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (res.ok) router.refresh();
    else alert("删除失败");
  }

  const cover = article.coverUrl || PLACEHOLDER_COVER;
  // 悬浮显示完整信息（标题 + 摘要），鼠标移上时浏览器原生 tooltip
  const hoverText = `${article.title || "无标题文章"}${
    article.digest ? `\n${article.digest}` : ""
  }`;
  const summary =
    article.digest?.trim() ||
    article.contentMd.slice(0, 80).replace(/[#*`>\-]/g, "") ||
    "（空白文档）";

  // 列表视图：横向布局
  if (view === "list") {
    return (
      <Link
        href={`/editor/${article.id}`}
        className="block h-full"
        title={hoverText}
      >
        <Card className="h-full hover:shadow-md hover:border-primary/40 transition-all cursor-pointer group flex flex-row items-center overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cover}
            alt=""
            className="w-28 h-20 object-cover shrink-0 bg-muted"
          />
          <div className="flex-1 min-w-0 p-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm line-clamp-1 group-hover:text-primary transition-colors">
                {article.title || "无标题文章"}
              </CardTitle>
              <Badge variant={STATUS_VARIANT[article.status] ?? "secondary"}>
                {STATUS_LABEL[article.status] ?? article.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
              {summary}
            </p>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
              <span>{article.theme?.name ?? "默认主题"}</span>
              <span>{formatDate(article.updatedAt)}</span>
            </div>
          </div>
          <div className="pr-3">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-600 p-1"
              title="删除"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </Card>
      </Link>
    );
  }

  // 网格视图：封面在上
  return (
    <Link
      href={`/editor/${article.id}`}
      className="block h-full"
      title={hoverText}
    >
      <Card className="h-full hover:shadow-md hover:border-primary/40 transition-all cursor-pointer group overflow-hidden flex flex-col">
        <div className="aspect-video bg-muted/40 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cover}
            alt={article.title || "无标题文章"}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base line-clamp-2 group-hover:text-primary transition-colors">
              {article.title || "无标题文章"}
            </CardTitle>
            <Badge variant={STATUS_VARIANT[article.status] ?? "secondary"}>
              {STATUS_LABEL[article.status] ?? article.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex-1">
          <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
            {summary}
          </p>
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span>{article.theme?.name ?? "默认主题"}</span>
            <span>{formatDate(article.updatedAt)}</span>
          </div>
          <div className="flex justify-end mt-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-600 p-1"
              title="删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
