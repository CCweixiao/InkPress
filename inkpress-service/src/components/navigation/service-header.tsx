"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { BookOpen, Download, LayoutDashboard, LogIn, Settings, ShieldCheck, Ticket, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ServiceHeaderProps = {
  isLoggedIn: boolean;
  email?: string | null;
  role?: string | null;
};

const publicLinks = [
  { href: "/#features", label: "功能" },
  { href: "/#workflow", label: "流程" },
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

  return (
    <header className="sticky top-0 z-40 border-b bg-background/88 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-6">
          <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="InkPress 首页">
            <Image
              src="/inkpress-logo.png"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 rounded-md"
              priority
            />
            <span className="text-base font-semibold tracking-tight">InkPress</span>
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
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors hover:bg-accent hover:text-accent-foreground",
                    active && item.href === "/guide" && "bg-primary/10 text-primary"
                  )}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex min-w-0 items-center gap-2">
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
                        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
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
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
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
              <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/" })}>
                退出
              </Button>
            </>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost">
                <Link href="/login">
                  <LogIn className="h-4 w-4" />
                  登录
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/register">
                  <UserPlus className="h-4 w-4" />
                  免费注册
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
