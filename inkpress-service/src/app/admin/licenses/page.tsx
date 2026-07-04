import Link from "next/link";
import { listLicenses } from "@/lib/license/admin-service";
import { durationLabel } from "@/lib/license/key";
import { GenerateLicenseDialog } from "@/components/admin/generate-license-dialog";
import {
  LicenseStatusBadge,
  LicenseLifecycleBadge,
} from "@/components/admin/status-badge";
import { Pager } from "@/components/admin/pager";
import { formatDate } from "@/lib/utils";

const PAGE_SIZE = 20;

export default async function LicensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const status = sp.status;
  const search = sp.search;
  const batchNo = sp.batchNo;
  const lifecycle = sp.lifecycle as
    | "PENDING"
    | "ACTIVATED"
    | "EXPIRED"
    | undefined;
  const { items, total } = await listLicenses({
    page,
    pageSize: PAGE_SIZE,
    status,
    search,
    batchNo,
    lifecycle,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">License 管理</h1>
        <GenerateLicenseDialog />
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-9 rounded-md border border-input bg-background px-2"
        >
          <option value="">全部状态</option>
          <option value="ENABLED">启用</option>
          <option value="DISABLED">已禁用</option>
          <option value="REVOKED">已撤销</option>
        </select>
        <select
          name="lifecycle"
          defaultValue={lifecycle ?? ""}
          className="h-9 rounded-md border border-input bg-background px-2"
        >
          <option value="">全部激活状态</option>
          <option value="PENDING">待激活</option>
          <option value="ACTIVATED">已激活</option>
          <option value="EXPIRED">已过期</option>
        </select>
        <input
          name="search"
          defaultValue={search ?? ""}
          placeholder="指纹 / 后缀 / 备注 / 批次"
          className="h-9 w-64 rounded-md border border-input bg-background px-3"
        />
        <input
          name="batchNo"
          defaultValue={batchNo ?? ""}
          placeholder="批次号"
          className="h-9 w-40 rounded-md border border-input bg-background px-3"
        />
        <button className="h-9 rounded-md bg-primary px-4 text-primary-foreground">
          筛选
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">指纹 / 后缀</th>
              <th className="px-3 py-2">有效期</th>
              <th className="px-3 py-2">设备</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">激活状态</th>
              <th className="px-3 py-2">归因</th>
              <th className="px-3 py-2">批次</th>
              <th className="px-3 py-2">创建</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  暂无 License
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 font-mono">
                  <div>{it.keyFingerprint}</div>
                  <div className="text-xs text-muted-foreground">…{it.displayKeySuffix}</div>
                </td>
                <td className="px-3 py-2">
                  {durationLabel(it.durationKind, it.durationYears, it.durationDays)}
                </td>
                <td className="px-3 py-2">
                  {it.activeDevices}/{it.maxDevices}
                </td>
                <td className="px-3 py-2">
                  <LicenseStatusBadge status={it.status} />
                </td>
                <td className="px-3 py-2">
                  <LicenseLifecycleBadge lifecycle={it.lifecycle} />
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {it.inviterCode ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs">{it.batchNo ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {formatDate(it.createdAt)}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/licenses/${it.id}`}
                    className="text-primary hover:underline"
                  >
                    详情
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/admin/licenses"
        searchParams={{ status, search, batchNo, lifecycle }}
      />
    </div>
  );
}
