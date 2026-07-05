import Link from "next/link";
import { getLicenseDetail } from "@/lib/license/admin-service";
import { durationLabel } from "@/lib/license/key";
import { AdminAction } from "@/components/admin/admin-action";
import { ExtendLicenseDialog } from "@/components/admin/extend-license-dialog";
import { RevealLicenseKeyDialog } from "@/components/admin/reveal-license-key-dialog";
import { DeleteLicenseDialog } from "@/components/admin/delete-license-dialog";
import {
  LicenseStatusBadge,
  LicenseLifecycleBadge,
  ActivationStatusBadge,
} from "@/components/admin/status-badge";
import { ValidationLogTable } from "@/components/admin/validation-log-table";
import { formatDate } from "@/lib/utils";

function expiresLabel(
  effectiveExpiresAt: Date | null,
  durationKind: string
): string {
  if (effectiveExpiresAt) return formatDate(effectiveExpiresAt);
  return durationKind === "PERMANENT" ? "永久" : "未激活（首激活后计算）";
}

export default async function LicenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { license, activeDevices } = await getLicenseDetail(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/licenses" className="text-sm text-muted-foreground hover:underline">
          ← 返回列表
        </Link>
      </div>

      <section className="rounded-lg border p-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">License 详情</h1>
          <div className="flex items-center gap-2">
            <LicenseStatusBadge status={license.status} />
            <LicenseLifecycleBadge lifecycle={license.lifecycle} />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
          <Field label="指纹" value={<code className="font-mono">{license.keyFingerprint}</code>} />
          <Field label="后缀" value={<code className="font-mono">…{license.displayKeySuffix}</code>} />
          <Field label="有效期模板" value={durationLabel(license.durationKind, license.durationYears, license.durationDays)} />
          <Field label="设备上限" value={String(license.maxDevices)} />
          <Field label="活跃设备" value={`${activeDevices}`} />
          <Field label="激活状态" value={<LicenseLifecycleBadge lifecycle={license.lifecycle} />} />
          <Field label="实际到期" value={expiresLabel(license.effectiveExpiresAt, license.durationKind)} />
          <Field label="归属用户" value={license.ownerEmail ?? "—"} />
          <Field label="归因邀请码" value={license.inviterCode ?? "—"} />
          <Field label="批次号" value={license.batchNo ?? "—"} />
          <Field label="首次激活" value={license.firstActivatedAt ? formatDate(license.firstActivatedAt) : "—"} />
          <Field label="创建时间" value={formatDate(license.createdAt)} />
          {license.disabledAt && <Field label="禁用时间" value={formatDate(license.disabledAt)} />}
          {license.revokedAt && <Field label="撤销时间" value={formatDate(license.revokedAt)} />}
        </dl>
        {license.note && (
          <div className="mt-3 text-sm">
            <span className="text-muted-foreground">备注：</span>
            {license.note}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <RevealLicenseKeyDialog
            licenseId={id}
            disabled={!license.hasStoredKey}
          />
          {license.status !== "REVOKED" && (
            <>
            {license.status === "ENABLED" && (
              <AdminAction
                label="禁用"
                href={`/api/admin/licenses/${id}`}
                body={{ status: "DISABLED" }}
                confirmText="确认禁用此 License？禁用后客户端校验将失败。"
                variant="outline"
              />
            )}
            {license.status === "DISABLED" && (
              <AdminAction
                label="启用"
                href={`/api/admin/licenses/${id}`}
                body={{ status: "ENABLED" }}
                confirmText="确认启用此 License？"
              />
            )}
            <AdminAction
              label="撤销（不可恢复）"
              href={`/api/admin/licenses/${id}`}
              body={{ status: "REVOKED" }}
              confirmText="撤销不可恢复，确认继续？"
              variant="destructive"
            />
            {license.status === "ENABLED" &&
              license.durationKind !== "PERMANENT" &&
              license.firstActivatedAt && (
                <ExtendLicenseDialog
                  licenseId={id}
                  currentExpiresAt={license.effectiveExpiresAt}
                />
              )}
            </>
          )}
          {(license.lifecycle === "PENDING" ||
            license.lifecycle === "EXPIRED") && (
            <DeleteLicenseDialog
              licenseId={id}
              keyFingerprint={license.keyFingerprint}
              displayKeySuffix={license.displayKeySuffix}
              lifecycle={license.lifecycle}
            />
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">激活设备</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">设备</th>
                <th className="px-3 py-2">环境</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">激活</th>
                <th className="px-3 py-2">最近校验</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {license.activations.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    暂无激活设备（Phase 3 客户端激活后出现）
                  </td>
                </tr>
              )}
              {license.activations.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">
                    {a.deviceIdHash.slice(0, 12)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {a.os ?? "—"}/{a.arch ?? "—"} · {a.appVersion ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <ActivationStatusBadge status={a.status} />
                  </td>
                  <td className="px-3 py-2 text-xs">{formatDate(a.activatedAt)}</td>
                  <td className="px-3 py-2 text-xs">
                    {a.lastValidatedAt ? formatDate(a.lastValidatedAt) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {a.status === "ACTIVE" && (
                      <AdminAction
                        label="解绑"
                        href={`/api/admin/licenses/${id}/activations/${a.id}/revoke`}
                        method="POST"
                        confirmText="确认解绑此设备？"
                        variant="destructive"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">最近校验日志</h2>
        <ValidationLogTable licenseId={id} />
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
