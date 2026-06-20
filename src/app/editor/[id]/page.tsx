import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { EditorWorkspace } from "@/components/editor/EditorWorkspace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export default async function EditorPage({ params }: Params) {
  const { id } = await params;
  const article = await prisma.article.findUnique({
    where: { id },
    include: { theme: true },
  });
  if (!article) notFound();

  const themes = await prisma.theme.findMany({
    orderBy: [{ isBuiltIn: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      cssContent: true,
      codeTheme: true,
      primaryColor: true,
    },
  });

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-border bg-background/80 backdrop-blur px-4 h-12 flex items-center gap-3 shrink-0">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-sm font-medium truncate">{article.title || "无标题文章"}</span>
      </header>
      <EditorWorkspace
        article={{
          id: article.id,
          title: article.title,
          contentMd: article.contentMd,
          digest: article.digest ?? "",
          coverMediaId: article.coverMediaId,
          themeId: article.themeId,
          status: article.status,
        }}
        themes={themes}
      />
    </div>
  );
}
