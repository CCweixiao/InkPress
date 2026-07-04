import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { NewTicketForm } from "@/components/tickets/new-ticket-form";

export default async function NewTicketPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard/tickets/new");
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-3">
          <Link
            href="/dashboard/tickets"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← 我的工单
          </Link>
          <span className="text-base font-semibold">新建工单</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="rounded-lg border bg-card p-6">
          <NewTicketForm />
        </div>
      </main>
    </div>
  );
}
