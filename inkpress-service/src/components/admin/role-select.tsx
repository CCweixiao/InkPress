"use client";

import { useRouter } from "next/navigation";

/** 用户角色下拉：改选即 PATCH，危险操作二次确认。 */
export function RoleSelect({
  userId,
  currentRole,
}: {
  userId: string;
  currentRole: string;
}) {
  const router = useRouter();

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const role = e.target.value;
    if (role === currentRole) return;
    if (
      !window.confirm(
        `确认将该用户改为「${role === "ADMIN" ? "管理员" : "普通用户"}」？`
      )
    ) {
      e.target.value = currentRole;
      return;
    }
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      window.alert(d?.error?.message ?? "操作失败");
      e.target.value = currentRole;
      return;
    }
    router.refresh();
  }

  return (
    <select
      defaultValue={currentRole}
      onChange={onChange}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
    >
      <option value="USER">普通用户</option>
      <option value="ADMIN">管理员</option>
    </select>
  );
}
