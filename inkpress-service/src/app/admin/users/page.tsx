import { auth } from "@/auth";
import { listUsers } from "@/lib/admin/user-service";
import { UserStatusBadge } from "@/components/admin/status-badge";
import { RoleSelect } from "@/components/admin/role-select";
import { AdminAction } from "@/components/admin/admin-action";
import { Pager } from "@/components/admin/pager";
import { formatDate } from "@/lib/utils";

const PAGE_SIZE = 20;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await auth();
  const meId = session?.user?.id;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const { items, total } = await listUsers({
    page,
    pageSize: PAGE_SIZE,
    search: sp.search,
    status: sp.status,
    role: sp.role,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">用户管理</h1>

      <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
        <select
          name="status"
          defaultValue={sp.status ?? ""}
          className="h-9 rounded-md border border-input bg-background px-2"
        >
          <option value="">全部状态</option>
          <option value="ACTIVE">正常</option>
          <option value="DISABLED">已禁用</option>
          <option value="DELETED">已删除</option>
        </select>
        <select
          name="role"
          defaultValue={sp.role ?? ""}
          className="h-9 rounded-md border border-input bg-background px-2"
        >
          <option value="">全部角色</option>
          <option value="USER">普通用户</option>
          <option value="ADMIN">管理员</option>
        </select>
        <input
          name="search"
          defaultValue={sp.search ?? ""}
          placeholder="邮箱 / 昵称"
          className="h-9 w-56 rounded-md border border-input bg-background px-3"
        />
        <button className="h-9 rounded-md bg-primary px-4 text-primary-foreground">筛选</button>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">邮箱</th>
              <th className="px-3 py-2">昵称</th>
              <th className="px-3 py-2">角色</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">邀请码</th>
              <th className="px-3 py-2">注册</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => {
              const isSelf = u.id === meId;
              return (
                <tr key={u.id} className="border-t">
                  <td className="px-3 py-2">{u.email}{isSelf && <span className="ml-1 text-xs text-muted-foreground">（你）</span>}</td>
                  <td className="px-3 py-2">{u.name ?? "—"}</td>
                  <td className="px-3 py-2">
                    <RoleSelect userId={u.id} currentRole={u.role} />
                  </td>
                  <td className="px-3 py-2"><UserStatusBadge status={u.status} /></td>
                  <td className="px-3 py-2 font-mono text-xs">{u.invitationCode?.code ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(u.createdAt)}</td>
                  <td className="px-3 py-2">
                    {u.status === "ACTIVE" ? (
                      <AdminAction
                        label={isSelf ? "禁用" : "禁用"}
                        href={`/api/admin/users/${u.id}`}
                        body={{ status: "DISABLED" }}
                        confirmText={isSelf ? "确认禁用自己的账号？你将无法登录。" : "确认禁用该用户？"}
                        variant="destructive"
                        disabled={isSelf}
                      />
                    ) : (
                      <AdminAction
                        label="启用"
                        href={`/api/admin/users/${u.id}`}
                        body={{ status: "ACTIVE" }}
                        confirmText="确认启用该用户？"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/admin/users"
        searchParams={{ status: sp.status, role: sp.role, search: sp.search }}
      />
    </div>
  );
}
