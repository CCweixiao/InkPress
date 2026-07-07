"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, List, X } from "lucide-react";
import { ServiceHeader } from "@/components/navigation/service-header";
import { Badge } from "@/components/ui/badge";
import { GuideToc } from "@/components/guide/guide-toc";
import { cn } from "@/lib/utils";
import type { GuideManifest, GuideItem } from "@/lib/guide";
import type { GuideTocItem } from "@/lib/guide-markdown";

const TOC_OPEN_STORAGE_KEY = "guide:toc-open";

type GuideViewProps = {
  manifest: GuideManifest;
  current: GuideItem;
  html: string;
  toc: GuideTocItem[];
  isLoggedIn: boolean;
  email?: string | null;
  role?: string | null;
};

export function GuideView({
  manifest,
  current,
  html,
  toc,
  isLoggedIn,
  email,
  role,
}: GuideViewProps) {
  // 默认收起；hydration 后读 localStorage 还原用户偏好
  const [tocOpen, setTocOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(TOC_OPEN_STORAGE_KEY) === "1") {
        // hydration 后从 localStorage 还原用户偏好：SSR 默认 false，客户端按需切换。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTocOpen(true);
      }
    } catch {
      // localStorage 不可用（隐私模式）→ 静默退化为默认收起
    }
  }, []);

  const toggleToc = () => {
    setTocOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TOC_OPEN_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // 持久化失败不影响当次切换
      }
      return next;
    });
  };

  // 是否有足够标题撑得起目录（h1 跳过，与 GuideToc 内部判定一致）
  const hasToc = toc.filter((item) => item.level > 1).length >= 3;
  const showTocColumn = hasToc && tocOpen;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ServiceHeader isLoggedIn={isLoggedIn} email={email} role={role} />
      <main
        className={cn(
          "mx-auto grid max-w-7xl gap-8 px-4 py-8 transition-[grid-template-columns] duration-200 ease-out sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)]",
          showTocColumn
            ? "xl:grid-cols-[280px_minmax(0,1fr)_240px]"
            : "xl:grid-cols-[280px_minmax(0,1fr)]"
        )}
      >
        <aside className="lg:sticky lg:top-[73px] lg:h-[calc(100vh-96px)] lg:overflow-y-auto">
          <div className="mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold">使用指引</h1>
              <p className="text-xs text-muted-foreground">InkPress 产品手册</p>
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

        {/* TOC 列：仅 xl 以上、且展开时才参与 grid 占位 */}
        {showTocColumn && (
          <aside className="hidden xl:block">
            <div className="sticky top-[73px] max-h-[calc(100vh-96px)] overflow-y-auto py-1">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  本页目录
                </span>
                <button
                  type="button"
                  onClick={toggleToc}
                  aria-label="收起目录"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <GuideToc items={toc} />
            </div>
          </aside>
        )}
      </main>

      {/* 浮动按钮：仅 xl 以上、且当前文章有 TOC 时显示 */}
      {hasToc && !showTocColumn && (
        <button
          type="button"
          onClick={toggleToc}
          aria-label="展开本页目录"
          title="展开本页目录"
          className="fixed right-6 top-[88px] z-40 hidden h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-colors hover:bg-accent xl:inline-flex"
        >
          <List className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
