import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const rawThemes = await prisma.theme.findMany({
    orderBy: [{ isBuiltIn: "desc" }, { createdAt: "asc" }],
  });
  // primaryColor 在 schema 可空（有默认值），ThemeItem 要求非空字符串，映射兜底
  const themes = rawThemes.map((t) => ({
    ...t,
    primaryColor: t.primaryColor ?? "#3f51b5",
  }));
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
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
              <Image src="/inkpress-logo-transparent.png" alt="InkPress" width={28} height={28} priority />
              <span className="font-semibold">设置</span>
            </div>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">工作台</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <SettingsShell themes={themes} />
      </main>
    </div>
  );
}
