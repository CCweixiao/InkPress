import Link from "next/link";
import { TicketStatusBadge } from "./ticket-status-badge";
import { TICKET_TYPE_LABELS } from "@/lib/tickets/constants";
import { formatDate } from "@/lib/utils";

interface TicketListItemProps {
  id: string;
  type: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  userEmail?: string;
  href: string;
}

export function TicketListItem({
  id,
  type,
  subject,
  status,
  updatedAt,
  userEmail,
  href,
}: TicketListItemProps) {
  return (
    <Link
      href={href}
      className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {TICKET_TYPE_LABELS[type] ?? type}
            </span>
            {userEmail && (
              <span className="text-xs text-muted-foreground">{userEmail}</span>
            )}
          </div>
          <p className="truncate text-sm font-medium">{subject}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            最后更新 {formatDate(updatedAt)}
          </p>
        </div>
        <TicketStatusBadge status={status} />
      </div>
    </Link>
  );
}
