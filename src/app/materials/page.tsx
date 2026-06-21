import Link from "next/link";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { prisma } from "@/lib/db";
import { hasOssConfig } from "@/lib/oss";
import { MaterialBrowser } from "@/components/materials/MaterialBrowser";

export const dynamic = "force-dynamic";

export default async function MaterialsPage() {
  const [spaces, articles, ossConfigured] = await Promise.all([
    prisma.space.findMany({
      where: { trashed: false },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.article.findMany({
      where: { trashed: false },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, spaceId: true },
    }),
    hasOssConfig(),
  ]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <span className="font-semibold">素材库</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">素材管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            按「空间 → 文章」目录组织素材。上传图片/视频/文件，复制外链插入文章。
          </p>
        </div>
        <MaterialBrowser
          spaces={JSON.parse(JSON.stringify(spaces))}
          articles={JSON.parse(JSON.stringify(articles))}
          ossConfigured={ossConfigured}
        />
      </main>
    </div>
  );
}
