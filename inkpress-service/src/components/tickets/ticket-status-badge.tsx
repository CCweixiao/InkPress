import { Badge } from "@/components/ui/badge";
import { TICKET_STATUS_LABELS } from "@/lib/tickets/constants";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  OPEN: "warning",
  ANSWERED: "default",
  RESOLVED: "success",
  CLOSED: "secondary",
};

export function TicketStatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANT[status] ?? "secondary";
  return (
    <Badge variant={variant}>
      {TICKET_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
