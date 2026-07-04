import Link from "next/link";
import { notFound } from "next/navigation";
import { getTicketForAdmin } from "@/lib/tickets/service";
import { TicketStatusBadge } from "@/components/tickets/ticket-status-badge";
import { TicketConversation, type ConversationMessage } from "@/components/tickets/ticket-conversation";
import { TicketAdminActions } from "@/components/tickets/ticket-admin-actions";
import {
  TICKET_TYPE_LABELS,
  TICKET_PRIORITY_LABELS,
} from "@/lib/tickets/constants";
import {
  parseAttachments,
  signedAttachments,
  type SignedAttachment,
} from "@/lib/tickets/attach";
import { signObjectUrl } from "@/lib/oss";
import { formatDate } from "@/lib/utils";

export default async function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ticket = await getTicketForAdmin(id).catch(() => null);
  if (!ticket) notFound();

  // 服务端签名附件 URL（OSS 未配置时降级为仅文件名）
  const signSafely = (raw: string): SignedAttachment[] => {
    const atts = parseAttachments(raw);
    if (atts.length === 0) return [];
    try {
      return signedAttachments(atts, (key) => signObjectUrl(key, 900));
    } catch {
      return atts;
    }
  };

  const messages: ConversationMessage[] = [
    {
      id: ticket.id,
      authorRole: "USER",
      authorEmail: ticket.user.email,
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
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/tickets"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← 工单列表
        </Link>
      </div>

      {/* 工单头 */}
      <div className="rounded-lg border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {TICKET_TYPE_LABELS[ticket.type] ?? ticket.type}
          </span>
          <TicketStatusBadge status={ticket.status} />
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            优先级：{TICKET_PRIORITY_LABELS[ticket.priority] ?? ticket.priority}
          </span>
          <span className="text-xs text-muted-foreground">
            创建于 {formatDate(ticket.createdAt)}
          </span>
        </div>
        <h1 className="text-lg font-semibold">{ticket.subject}</h1>
        <div className="text-xs text-muted-foreground">
          用户：<span className="font-mono">{ticket.user.email}</span>
        </div>
        <TicketAdminActions
          ticketId={ticket.id}
          status={ticket.status}
          priority={ticket.priority}
        />
      </div>

      {/* 会话 */}
      <TicketConversation
        ticketId={ticket.id}
        ticketStatus={ticket.status}
        messages={messages}
        viewerRole="ADMIN"
      />
    </div>
  );
}
