import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ServiceHeader } from "@/components/navigation/service-header";
import { NewTicketForm } from "@/components/tickets/new-ticket-form";

export default async function NewTicketPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard/tickets/new");
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <ServiceHeader
        isLoggedIn
        email={session.user.email ?? null}
        role={session.user.role ?? null}
      />

      <main className="mx-auto max-w-2xl space-y-4 px-6 py-8">
        <div>
          <Link
            href="/dashboard/tickets"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← 返回我的工单
          </Link>
          <h1 className="mt-3 text-2xl font-bold">新建工单</h1>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <NewTicketForm />
        </div>
      </main>
    </div>
  );
}
