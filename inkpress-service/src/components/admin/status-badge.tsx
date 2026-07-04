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

/**
 * License 激活生命周期（PENDING/ACTIVATED/EXPIRED）。
 * 与 LicenseStatusBadge（管理态 ENABLED/DISABLED/REVOKED）正交，
 * 命名独立以避免与 ActivationStatusBadge（设备激活态 ACTIVE/DEACTIVATED/REVOKED）混淆。
 */
const LICENSE_LIFECYCLE: Record<string, [Variant, string]> = {
  PENDING: ["secondary", "待激活"],
  ACTIVATED: ["success", "已激活"],
  EXPIRED: ["warning", "已过期"],
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

export function LicenseLifecycleBadge({ lifecycle }: { lifecycle: string }) {
  const [v, l] = LICENSE_LIFECYCLE[lifecycle] ??
    (["secondary", lifecycle] as [Variant, string]);
  return <Badge variant={v}>{l}</Badge>;
}
