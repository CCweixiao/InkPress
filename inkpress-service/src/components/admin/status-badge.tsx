import { Badge } from "@/components/ui/badge";

type Variant = React.ComponentProps<typeof Badge>["variant"];

const LICENSE: Record<string, [Variant, string]> = {
  ENABLED: ["success", "启用"],
  DISABLED: ["warning", "已禁用"],
  REVOKED: ["destructive", "已撤销"],
};

const ACTIVATION: Record<string, [Variant, string]> = {
  ACTIVE: ["success", "活跃"],
  DEACTIVATED: ["warning", "已停用"],
  REVOKED: ["destructive", "已撤销"],
};

const USER: Record<string, [Variant, string]> = {
  ACTIVE: ["success", "正常"],
  DISABLED: ["warning", "已禁用"],
  DELETED: ["destructive", "已删除"],
};

export function LicenseStatusBadge({ status }: { status: string }) {
  const [v, l] = LICENSE[status] ?? (["secondary", status] as [Variant, string]);
  return <Badge variant={v}>{l}</Badge>;
}

export function ActivationStatusBadge({ status }: { status: string }) {
  const [v, l] = ACTIVATION[status] ?? (["secondary", status] as [Variant, string]);
  return <Badge variant={v}>{l}</Badge>;
}

export function UserStatusBadge({ status }: { status: string }) {
  const [v, l] = USER[status] ?? (["secondary", status] as [Variant, string]);
  return <Badge variant={v}>{l}</Badge>;
}
