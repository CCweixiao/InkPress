import { Badge } from "@/components/ui/badge";

type Variant = React.ComponentProps<typeof Badge>["variant"];

const ORDER_STATUS: Record<string, [Variant, string]> = {
  PENDING: ["warning", "待支付"],
  PAID: ["success", "已支付"],
  CLOSED: ["secondary", "已关闭"],
  REFUNDED: ["destructive", "已退款"],
};

export function OrderStatusBadge({ status }: { status: string }) {
  const [v, l] = ORDER_STATUS[status] ?? (["secondary", status] as [Variant, string]);
  return <Badge variant={v}>{l}</Badge>;
}
