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

export type ArticleListItem = {
  id: string;
  title: string;
  contentMd: string;
  status: string;
  theme?: { name: string } | null;
  updatedAt: string;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success"> = {
  draft: "secondary",
  ready: "default",
  pushed: "success",
};

export function ArticleCard({ article }: { article: ArticleListItem }) {
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

  return (
    <Link href={`/editor/${article.id}`} className="block h-full">
      <Card className="h-full hover:shadow-md hover:border-primary/40 transition-all cursor-pointer group">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base line-clamp-2 group-hover:text-primary transition-colors">
              {article.title || "无标题文章"}
            </CardTitle>
            <Badge variant={STATUS_VARIANT[article.status] ?? "secondary"}>
              {STATUS_LABEL[article.status] ?? article.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
            {article.contentMd.slice(0, 80).replace(/[#*`>\-]/g, "") ||
              "（空白文档）"}
          </p>
          <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
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
