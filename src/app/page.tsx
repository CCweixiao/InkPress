import Link from "next/link";
import { FileText, Palette, Settings, Sparkles } from "lucide-react";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NewArticleButton } from "@/components/articles/NewArticleButton";
import { ArticleCard } from "@/components/articles/ArticleCard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const articles = await prisma.article.findMany({
    orderBy: { updatedAt: "desc" },
    include: { theme: { select: { name: true } } },
  });

  return (
    <div className="min-h-screen">
      {/* 顶栏 */}
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="font-semibold text-lg">InkPress</span>
            <span className="text-xs text-muted-foreground ml-1">
              AI 公众号写作台
            </span>
          </div>
          <nav className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/themes">
                <Palette className="h-4 w-4" />
                主题
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings">
                <Settings className="h-4 w-4" />
                设置
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">我的文章</h1>
            <p className="text-sm text-muted-foreground mt-1">
              AI 生成、实时预览、一键推送到公众号草稿箱
            </p>
          </div>
          <NewArticleButton />
        </div>

        {articles.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-20 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground mb-4">
                还没有文章，新建一篇开始创作吧
              </p>
              <NewArticleButton />
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {articles.map((article) => (
              <ArticleCard
                key={article.id}
                article={{
                  id: article.id,
                  title: article.title,
                  contentMd: article.contentMd,
                  status: article.status,
                  theme: article.theme,
                  updatedAt: article.updatedAt.toISOString(),
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
