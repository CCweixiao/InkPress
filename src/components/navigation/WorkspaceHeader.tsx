"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Boxes,
  CheckSquare,
  FolderOpen,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import { GlobalSearch } from "@/components/common/GlobalSearch";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { APP_VERSION } from "@/lib/site";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/tasks", label: "任务", icon: CheckSquare },
  { href: "/snippets", label: "灵感", icon: Sparkles },
  { href: "/materials", label: "素材", icon: FolderOpen },
  { href: "/skills", label: "技能仓库", icon: Boxes },
  { href: "/recycle", label: "回收站", icon: Trash2 },
  { href: "/settings", label: "设置", icon: Settings },
] as const;

function WorkspaceNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="工作台导航"
      className={cn(
        "workspace-nav-shell flex items-center gap-1 rounded-2xl bg-slate-100/72 p-1.5 ring-1 ring-slate-200/70 dark:bg-white/[0.055] dark:ring-white/[0.07]",
        mobile && "w-max min-w-full"
      )}
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            title={label}
            className={cn(
              "group relative flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-[13px] font-medium text-slate-600 outline-none transition-[color,background-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:bg-white/85 hover:text-slate-950 hover:shadow-[0_5px_16px_rgba(37,99,235,0.09)] focus-visible:ring-2 focus-visible:ring-primary/40 dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white dark:hover:shadow-none",
              active &&
                "bg-white text-primary shadow-[0_6px_18px_rgba(37,99,235,0.13)] ring-1 ring-blue-100/90 hover:text-primary dark:bg-blue-500/14 dark:text-blue-300 dark:ring-blue-400/18"
            )}
          >
            <span
              className={cn(
                "grid h-6 w-6 place-items-center rounded-lg text-slate-500 transition-colors group-hover:bg-blue-50 group-hover:text-primary dark:text-slate-400 dark:group-hover:bg-blue-400/10 dark:group-hover:text-blue-300",
                active && "bg-blue-50 text-primary dark:bg-blue-400/12 dark:text-blue-300"
              )}
            >
              <Icon className="h-[15px] w-[15px]" strokeWidth={2} />
            </span>
            <span>{label}</span>
            {active && (
              <span
                aria-hidden="true"
                className="absolute -bottom-1 h-1 w-4 rounded-full bg-primary/80 shadow-[0_0_9px_rgba(37,99,235,0.45)]"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function WorkspaceHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/65 bg-background/88 shadow-[0_1px_18px_rgba(15,23,42,0.035)] backdrop-blur-xl dark:border-white/[0.07] dark:shadow-none">
      <div className="mx-auto max-w-[1480px] px-4 sm:px-6">
        <div className="flex h-16 items-center gap-3 xl:gap-5">
          <Link
            href="/"
            aria-label="返回 InkPress 工作台"
            className="group flex shrink-0 items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-[14px] bg-[linear-gradient(145deg,#eef4ff,#ffffff_62%)] shadow-[0_8px_22px_rgba(37,99,235,0.14)] ring-1 ring-blue-100/90 transition-transform duration-200 group-hover:-translate-y-0.5 dark:bg-[linear-gradient(145deg,rgba(59,130,246,0.18),rgba(255,255,255,0.06))] dark:ring-blue-400/15">
              <span className="absolute inset-x-1 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent" />
              <Image
                src="/inkpress-logo-transparent.png"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 drop-shadow-[0_3px_6px_rgba(37,99,235,0.22)]"
                priority
              />
            </span>
            <span className="min-w-0 leading-none">
              <span className="block text-[18px] font-semibold tracking-[-0.025em] text-slate-950 dark:text-slate-50">
                InkPress
              </span>
              <span className="mt-1.5 hidden text-[10px] font-medium tracking-[0.12em] text-slate-400 sm:block dark:text-slate-500">
                数字文刊工坊
              </span>
            </span>
          </Link>

          <div className="ml-1 shrink-0">
            <GlobalSearch
              showShortcut
              triggerClassName="h-9 rounded-xl bg-slate-100/72 px-3 ring-1 ring-slate-200/70 hover:bg-white hover:shadow-[0_5px_16px_rgba(37,99,235,0.08)] dark:bg-white/[0.055] dark:ring-white/[0.07] dark:hover:bg-white/[0.09]"
            />
          </div>

          <div className="hidden min-w-0 flex-1 justify-center xl:flex">
            <WorkspaceNav />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1 rounded-2xl bg-slate-50/80 p-1 ring-1 ring-slate-200/65 dark:bg-white/[0.035] dark:ring-white/[0.07]">
            <ThemeToggle className="h-8 w-8 rounded-xl text-slate-600 hover:bg-white hover:text-primary hover:shadow-sm dark:text-slate-300 dark:hover:bg-white/[0.08]" />
            <a
              href="https://www.longoflow.com/guide/tavily-setting"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="文档手册"
              title={`文档手册 · v${APP_VERSION}`}
              className="group flex h-8 items-center gap-1.5 rounded-xl px-2 text-slate-600 transition-colors hover:bg-white hover:text-primary hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:text-slate-300 dark:hover:bg-white/[0.08]"
            >
              <BookOpen className="h-4 w-4" />
              <span className="rounded-md bg-slate-200/75 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-slate-500 transition-colors group-hover:bg-blue-50 group-hover:text-primary dark:bg-white/[0.09] dark:text-slate-400 dark:group-hover:bg-blue-400/15 dark:group-hover:text-blue-300">
                v{APP_VERSION}
              </span>
            </a>
          </div>
        </div>

        <div className="workspace-nav-scroll -mx-4 overflow-x-auto px-4 pb-2.5 xl:hidden sm:-mx-6 sm:px-6">
          <WorkspaceNav mobile />
        </div>
      </div>
    </header>
  );
}
