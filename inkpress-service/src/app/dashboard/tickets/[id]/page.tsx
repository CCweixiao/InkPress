import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { TicketStatusBadge } from "@/components/tickets/ticket-status-badge";
import { TicketConversation, type ConversationMessage } from "@/components/tickets/ticket-conversation";
import { TICKET_TYPE_LABELS } from "@/lib/tickets/constants";
import {
  parseAttachments,
  signedAttachments,
  type SignedAttachment,
} from "@/lib/tickets/attach";
import { signObjectUrl } from "@/lib/oss";
import { formatDate } from "@/lib/utils";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      replies: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!ticket || ticket.userId !== session.user.id) {
    redirect("/dashboard/tickets");
  }

  // 服务端签名附件 URL（OSS 未配置时降级为仅文件名）
  const signSafely = (raw: string): SignedAttachment[] => {
    const atts = parseAttachments(raw);
    if (atts.length === 0) return [];
    try {
      return signedAttachments(atts, (key) => signObjectUrl(key, 900));
    } catch {
      return atts; // 无 url，仅展示文件名
    }
  };

  // 构建会话消息流：首条描述作为第一条消息 + 所有回复
  const messages: ConversationMessage[] = [
    {
      id: ticket.id,
      authorRole: "USER",
      authorEmail: session.user.email ?? undefined,
      content: ticket.description,
      createdAt: ticket.createdAt.toISOString(),
      signedAttachments: signSafely(ticket.attachments),
    },
    ...ticket.replies.map((r) => ({
      id: r.id,
      authorRole: r.authorRole,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
      signedAttachments: signSafely(r.attachments),
    })),
  ];

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
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        {/* 工单头 */}
        <div className="rounded-lg border bg-card p-5">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {TICKET_TYPE_LABELS[ticket.type] ?? ticket.type}
            </span>
            <TicketStatusBadge status={ticket.status} />
            <span className="text-xs text-muted-foreground">
              创建于 {formatDate(ticket.createdAt)}
            </span>
          </div>
          <h1 className="text-lg font-semibold">{ticket.subject}</h1>
        </div>

        {/* 会话 */}
        <TicketConversation
          ticketId={ticket.id}
          ticketStatus={ticket.status}
          messages={messages}
          viewerRole="USER"
        />
      </main>
    </div>
  );
}
