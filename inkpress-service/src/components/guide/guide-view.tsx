"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronDown, ChevronRight, List, Sparkles, X } from "lucide-react";
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  const guideNavigation = (
    <nav className="space-y-6" aria-label="使用指引章节">
      {manifest.sections.map((section) => (
        <section key={section.title}>
          <div className="mb-2.5 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {section.title}
          </div>
          <div className="space-y-1">
            {section.items.map((item) => (
              <Link
                key={item.slug}
                href={item.slug === manifest.sections[0]?.items[0]?.slug ? "/guide" : `/guide/${item.slug}`}
                onClick={() => setMobileNavOpen(false)}
                className={cn(
                  "group block rounded-xl px-3 py-2.5 text-sm transition-all hover:bg-white/80",
                  item.slug === current.slug && "bg-blue-100/65 text-blue-700"
                )}
              >
                <span className="flex items-center justify-between gap-2 font-medium">
                  {item.title}
                  {item.slug === current.slug && <ChevronRight className="h-3.5 w-3.5" />}
                </span>
                {item.description && (
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    {item.description}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#f6f8fc] text-foreground">
      <ServiceHeader isLoggedIn={isLoggedIn} email={email} role={role} />

      <div className="relative overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#f6f8fc_100%)]">
        <div className="absolute left-1/2 top-0 h-48 w-2/3 -translate-x-1/2 rounded-full bg-blue-100/45 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 py-9 sm:px-6 sm:py-10 lg:px-10">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
            <Sparkles className="h-3.5 w-3.5" />
            InkPress handbook
          </div>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">使用指引</h1>
              <p className="mt-2 max-w-xl text-sm leading-7 text-slate-600">从第一次打开 InkPress 到完成创作、管理订单与提交问题，所需信息都整理在这里。</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <BookOpen className="h-4 w-4 text-blue-600" />
              当前：<span className="font-medium text-slate-800">{current.title}</span>
            </div>
          </div>
        </div>
      </div>

      <main
        className={cn(
          "mx-auto grid max-w-7xl gap-6 px-4 py-6 transition-[grid-template-columns] duration-200 ease-out sm:px-6 sm:py-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8 lg:px-10",
          showTocColumn
            ? "xl:grid-cols-[260px_minmax(0,1fr)_220px]"
            : "xl:grid-cols-[260px_minmax(0,1fr)]"
        )}
      >
        <div className="lg:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-expanded={mobileNavOpen}
            className="flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3 text-left shadow-[0_10px_30px_rgba(30,64,175,0.06)]"
          >
            <span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">文档目录</span>
              <span className="mt-0.5 block text-sm font-medium text-slate-900">{current.title}</span>
            </span>
            <ChevronDown className={cn("h-4 w-4 text-slate-500 transition-transform", mobileNavOpen && "rotate-180")} />
          </button>
          {mobileNavOpen && <div className="mt-2 rounded-2xl bg-[#f0f4fb] p-3 shadow-lg">{guideNavigation}</div>}
        </div>

        <aside className="hidden lg:sticky lg:top-20 lg:block lg:h-[calc(100vh-96px)] lg:overflow-y-auto lg:pr-2">
          <div className="mb-5 flex items-center gap-2.5 px-1">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><BookOpen className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">文档目录</h2>
              <p className="text-[11px] text-slate-500">快速找到所需内容</p>
            </div>
          </div>
          {guideNavigation}
        </aside>

        <article className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-full bg-white px-3 py-1 shadow-sm">产品手册</Badge>
            <Badge variant="outline" className="rounded-full border-0 bg-white px-3 py-1 text-slate-500 shadow-sm">持续更新</Badge>
          </div>
          <div
            className="guide-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </article>

        {/* TOC 列：仅 xl 以上、且展开时才参与 grid 占位 */}
        {showTocColumn && (
          <aside className="hidden xl:block">
            <div className="sticky top-20 max-h-[calc(100vh-96px)] overflow-y-auto rounded-2xl bg-white/80 p-4 shadow-[0_12px_35px_rgba(30,64,175,0.055)] backdrop-blur">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  本页目录
                </span>
                <button
                  type="button"
                  onClick={toggleToc}
                  aria-label="收起目录"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-slate-100 hover:text-foreground"
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
          className="fixed right-6 top-[84px] z-40 hidden h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg transition hover:-translate-y-0.5 hover:bg-slate-50 xl:inline-flex"
        >
          <List className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
