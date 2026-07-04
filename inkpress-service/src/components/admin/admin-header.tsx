"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin/licenses", label: "License" },
  { href: "/admin/orders", label: "订单" },
  { href: "/admin/plans", label: "订阅计划" },
  { href: "/admin/users", label: "用户" },
  { href: "/admin/tickets", label: "工单" },
  { href: "/admin/audit-logs", label: "审计日志" },
];

export function AdminHeader({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="font-semibold">InkPress · 管理后台</span>
          <nav className="flex gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  pathname.startsWith(n.href)
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent"
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/dashboard" className="hover:underline">
            返回用户区
          </Link>
          <span>{email}</span>
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/login" })}>
            退出
          </Button>
        </div>
      </div>
    </header>
  );
}
