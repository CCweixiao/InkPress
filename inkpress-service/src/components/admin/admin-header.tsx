"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { BookOpen, Home, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin/licenses", label: "License" },
  { href: "/admin/orders", label: "订单" },
  { href: "/admin/plans", label: "订阅计划" },
  { href: "/admin/releases", label: "软件版本" },
  { href: "/admin/users", label: "用户" },
  { href: "/admin/tickets", label: "工单" },
  { href: "/admin/audit-logs", label: "审计日志" },
];

export function AdminHeader({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/88 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Link href="/admin" className="font-semibold tracking-tight">
            InkPress · 管理后台
          </Link>
          <nav className="flex flex-wrap gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  pathname.startsWith(n.href)
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground">
            <Home className="h-3.5 w-3.5" />
            主页
          </Link>
          <Link href="/guide" className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            使用指引
          </Link>
          <Link href="/dashboard" className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground">
            <LayoutDashboard className="h-3.5 w-3.5" />
            用户控制台
          </Link>
          <span className="hidden max-w-[180px] truncate xl:inline">{email}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            退出
          </Button>
        </div>
      </div>
    </header>
  );
}
