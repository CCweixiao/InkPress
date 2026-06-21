import Link from "next/link";
import { ArrowLeft, Boxes } from "lucide-react";
import { SkillBrowser } from "@/components/skills/SkillBrowser";

export const dynamic = "force-dynamic";

export default function SkillsPage() {
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
            <Boxes className="h-5 w-5 text-primary" />
            <span className="font-semibold">技能仓库</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">技能仓库</h1>
          <p className="text-sm text-muted-foreground mt-1">
            浏览、新建、编辑写作技能。用户技能可被写作助手自动识别并按需应用；系统技能仅查看。
          </p>
        </div>
        <SkillBrowser />
      </main>
    </div>
  );
}
