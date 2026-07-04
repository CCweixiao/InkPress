import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ServiceHeader } from "@/components/navigation/service-header";
import { TicketListItem } from "@/components/tickets/ticket-list-item";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 20;

export default async function MyTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard/tickets");
  }

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const status = sp.status;

  const where = {
    userId: session.user.id,
    ...(status ? { status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.ticket.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-muted/30">
      <ServiceHeader
        isLoggedIn
        email={session.user.email ?? null}
        role={session.user.role ?? null}
      />

      <main className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">我的工单</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              提交问题、上传截图并跟进处理状态。
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/dashboard/tickets/new">新建工单</Link>
          </Button>
        </div>

        {/* 状态筛选 */}
        <div className="flex gap-2 text-sm">
          <Link
            href="/dashboard/tickets"
            className={`rounded-md px-3 py-1 ${
              !status ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            全部
          </Link>
          {["OPEN", "ANSWERED", "RESOLVED", "CLOSED"].map((s) => (
            <Link
              key={s}
              href={`/dashboard/tickets?status=${s}`}
              className={`rounded-md px-3 py-1 ${
                status === s
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {s === "OPEN" ? "待处理" : s === "ANSWERED" ? "已回复" : s === "RESOLVED" ? "已解决" : "已关闭"}
            </Link>
          ))}
        </div>

        {items.length === 0 ? (
          <div className="rounded-lg border bg-card p-10 text-center text-muted-foreground">
            暂无工单
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((t) => (
              <TicketListItem
                key={t.id}
                id={t.id}
                type={t.type}
                subject={t.subject}
                status={t.status}
                createdAt={t.createdAt.toISOString()}
                updatedAt={t.updatedAt.toISOString()}
                href={`/dashboard/tickets/${t.id}`}
              />
            ))}
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center gap-3 text-sm">
            {page > 1 ? (
              <Link
                href={`/dashboard/tickets?page=${page - 1}${status ? `&status=${status}` : ""}`}
                className="text-primary hover:underline"
              >
                上一页
              </Link>
            ) : (
              <span className="text-muted-foreground/50">上一页</span>
            )}
            <span className="text-muted-foreground">
              {page} / {pages}（共 {total}）
            </span>
            {page < pages ? (
              <Link
                href={`/dashboard/tickets?page=${page + 1}${status ? `&status=${status}` : ""}`}
                className="text-primary hover:underline"
              >
                下一页
              </Link>
            ) : (
              <span className="text-muted-foreground/50">下一页</span>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
