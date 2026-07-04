import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { ServiceHeader } from "@/components/navigation/service-header";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GuideManifest, GuideItem } from "@/lib/guide";

type GuideViewProps = {
  manifest: GuideManifest;
  current: GuideItem;
  html: string;
  isLoggedIn: boolean;
  email?: string | null;
  role?: string | null;
};

export function GuideView({
  manifest,
  current,
  html,
  isLoggedIn,
  email,
  role,
}: GuideViewProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ServiceHeader isLoggedIn={isLoggedIn} email={email} role={role} />
      <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-[73px] lg:h-[calc(100vh-96px)] lg:overflow-y-auto">
          <div className="mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold">使用指引</h1>
              <p className="text-xs text-muted-foreground">InkPress Service 本地手册</p>
            </div>
          </div>
          <nav className="space-y-5">
            {manifest.sections.map((section) => (
              <section key={section.title}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {section.title}
                </div>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <Link
                      key={item.slug}
                      href={item.slug === manifest.sections[0]?.items[0]?.slug ? "/guide" : `/guide/${item.slug}`}
                      className={cn(
                        "block rounded-lg border border-transparent px-3 py-2 text-sm transition-colors hover:border-border hover:bg-accent",
                        item.slug === current.slug && "border-primary/20 bg-primary/10 text-primary"
                      )}
                    >
                      <span className="flex items-center justify-between gap-2 font-medium">
                        {item.title}
                        {item.slug === current.slug && <ChevronRight className="h-3.5 w-3.5" />}
                      </span>
                      {item.description && (
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </nav>
        </aside>

        <article className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">本地 Markdown</Badge>
            <Badge variant="outline">JSON 目录驱动</Badge>
          </div>
          <div
            className="guide-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </article>
      </main>
    </div>
  );
}
