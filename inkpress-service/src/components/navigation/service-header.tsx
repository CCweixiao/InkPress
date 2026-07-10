"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { BookOpen, Download, LayoutDashboard, LogIn, Menu, Settings, ShieldCheck, Ticket, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ServiceHeaderProps = {
  isLoggedIn: boolean;
  email?: string | null;
  role?: string | null;
};

const publicLinks = [
  { href: "/#features", label: "功能" },
  { href: "/#cases", label: "案例" },
  { href: "/#pricing", label: "价格" },
  { href: "/downloads", label: "下载", icon: Download },
  { href: "/guide", label: "使用指引", icon: BookOpen },
];

const accountLinks = [
  { href: "/dashboard", label: "控制台", icon: LayoutDashboard },
  { href: "/dashboard/tickets", label: "工单", icon: Ticket },
  { href: "/settings", label: "个人设置", icon: Settings },
];

export function ServiceHeader({ isLoggedIn, email, role }: ServiceHeaderProps) {
  const pathname = usePathname();
  const isAdmin = role === "ADMIN";
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 bg-white/92 shadow-[0_6px_24px_rgba(30,64,175,0.045)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-6">
          <Link href="/" onClick={() => setMenuOpen(false)} className="group flex shrink-0 items-center gap-2.5" aria-label="InkPress 首页">
            <Image
              src="/inkpress-logo.png"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 rounded-lg shadow-sm transition-transform group-hover:scale-105"
              priority
            />
            <span className="text-base font-semibold tracking-[-0.02em]">InkPress</span>
          </Link>
          <nav className="hidden items-center gap-1 text-sm text-muted-foreground lg:flex">
            {publicLinks.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/guide"
                  ? pathname.startsWith("/guide")
                  : item.href === "/downloads"
                    ? pathname.startsWith("/downloads")
                    : pathname === "/" && item.href.startsWith("/#");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-2 transition-colors hover:bg-slate-100 hover:text-slate-950",
                    active && item.href === "/guide" && "bg-blue-50 text-blue-700"
                  )}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          {isLoggedIn ? (
            <>
              <nav className="hidden items-center gap-1 md:flex">
                {accountLinks.map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.href === "/dashboard"
                      ? pathname === "/dashboard"
                      : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-950",
                        active && "bg-primary/10 text-primary"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {item.label}
                    </Link>
                  );
                })}
                {isAdmin && (
                  <Link
                    href="/admin"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-950",
                      pathname.startsWith("/admin") && "bg-primary/10 text-primary"
                    )}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    管理后台
                  </Link>
                )}
              </nav>
              <span className="hidden max-w-[180px] truncate text-xs text-muted-foreground xl:inline">
                {email}
              </span>
              <Button variant="ghost" size="sm" className="hidden rounded-full md:inline-flex" onClick={() => signOut({ callbackUrl: "/" })}>
                退出
              </Button>
            </>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost" className="hidden rounded-full sm:inline-flex">
                <Link href="/login">
                  <LogIn className="h-4 w-4" />
                  登录
                </Link>
              </Button>
              <Button asChild size="sm" className="hidden rounded-full shadow-[0_8px_20px_rgba(37,99,235,0.16)] sm:inline-flex">
                <Link href="/register">
                  <UserPlus className="h-4 w-4" />
                  免费注册
                </Link>
              </Button>
            </>
          )}
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100/80 text-slate-700 transition hover:bg-slate-200/70 lg:hidden"
            aria-label={menuOpen ? "关闭导航菜单" : "打开导航菜单"}
            aria-expanded={menuOpen}
            aria-controls="service-mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="h-4.5 w-4.5" /> : <Menu className="h-4.5 w-4.5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div id="service-mobile-menu" className="absolute inset-x-0 top-16 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl lg:hidden">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
            <nav className="grid gap-1 sm:grid-cols-2" aria-label="移动端主导航">
              {publicLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-950">
                    <span className="flex items-center gap-2.5">{Icon ? <Icon className="h-4 w-4 text-slate-400" /> : <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {isLoggedIn ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                {email && <p className="mb-2 truncate px-3 text-xs text-slate-400">{email}</p>}
                <div className="grid gap-1 sm:grid-cols-2">
                  {accountLinks.map((item) => {
                    const Icon = item.icon;
                    return <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-3 text-sm text-slate-700 hover:bg-slate-100"><Icon className="h-4 w-4 text-slate-400" />{item.label}</Link>;
                  })}
                  {isAdmin && <Link href="/admin" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-3 text-sm text-slate-700 hover:bg-slate-100"><ShieldCheck className="h-4 w-4 text-slate-400" />管理后台</Link>}
                </div>
                <button type="button" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50" onClick={() => signOut({ callbackUrl: "/" })}>退出登录</button>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 sm:hidden">
                <Button asChild variant="outline" className="rounded-full"><Link href="/login"><LogIn className="h-4 w-4" />登录</Link></Button>
                <Button asChild className="rounded-full"><Link href="/register"><UserPlus className="h-4 w-4" />免费注册</Link></Button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
