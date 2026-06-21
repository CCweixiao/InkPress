import Link from "next/link";
import { ArrowLeft, Palette } from "lucide-react";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { ThemeManager } from "@/components/themes/ThemeManager";

export const dynamic = "force-dynamic";

export default async function ThemesPage() {
  const themes = await prisma.theme.findMany({
    orderBy: [{ isBuiltIn: "desc" }, { createdAt: "asc" }],
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </Link>
            <span className="text-muted-foreground/40">/</span>
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-primary" />
              <span className="font-semibold">主题管理</span>
            </div>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">工作台</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <p className="text-sm text-muted-foreground mb-6">
          管理公众号文章排版主题。内置主题基于 doocs/md，可自定义 CSS、代码高亮与主题色。
        </p>
        <ThemeManager
          themes={themes.map((t) => ({
            id: t.id,
            name: t.name,
            cssContent: t.cssContent,
            codeTheme: t.codeTheme,
            primaryColor: t.primaryColor ?? "#3f51b5",
            isBuiltIn: t.isBuiltIn,
            isDefault: t.isDefault,
          }))}
        />
      </main>
    </div>
  );
}
