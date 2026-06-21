import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { readContent } from "@/lib/content-store";
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

  const contentMd = article.contentPath
    ? await readContent(article.id)
    : (article.contentMd ?? "");

  const themes = await prisma.theme.findMany({
    orderBy: [{ isBuiltIn: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      cssContent: true,
      codeTheme: true,
      primaryColor: true,
      isDefault: true,
    },
  });

  return (
    <EditorWorkspace
      article={{
        id: article.id,
        title: article.title,
        contentMd,
        digest: article.digest ?? "",
        coverMediaId: article.coverMediaId,
        coverUrl: article.coverUrl,
        themeId: article.themeId,
        spaceId: article.spaceId,
        status: article.status,
      }}
      themes={themes}
    />
  );
}
