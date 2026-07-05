import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { listAllReleases, CHANNEL_META } from "@/lib/release/service";
import { ReleasesAdminTable } from "@/components/releases/admin-table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { ReleaseChannel } from "@/lib/validation/schemas";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ChannelBadge({ channel }: { channel: string }) {
  const meta = CHANNEL_META[channel as ReleaseChannel];
  if (!meta) return <Badge variant="outline">{channel}</Badge>;
  return <Badge variant={meta.tone}>{meta.label}</Badge>;
}

/**
 * /admin/releases — 软件版本管理。
 *
 * 仅 CI 自动登记，管理员在此：编辑元信息、隐藏/恢复、删除误登。
 * 不提供「新建」入口——所有记录都来自 CI。
 */
export default async function AdminReleasesPage() {
  await requireAdmin();
  const { items } = await listAllReleases({
    page: 1,
    pageSize: 100,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">软件版本</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          CI 打包后自动登记。管理员可编辑 changelog、隐藏或删除版本。
          点击某行右侧图标进入详情编辑。
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">包名</th>
              <th className="px-3 py-2">平台</th>
              <th className="px-3 py-2">版本</th>
              <th className="px-3 py-2">大小</th>
              <th className="px-3 py-2">通道</th>
              <th className="px-3 py-2">下载</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">发布时间</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  暂无软件版本
                  <div className="mt-1 text-xs">
                    CI 完成第一次{" "}
                    <code className="font-mono">pnpm release:full</code>{" "}
                    后会自动登记到这里
                  </div>
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/releases/${it.id}`}
                    className="font-medium hover:underline"
                  >
                    {it.displayName}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground">
                    {it.packageName}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{it.platform}</td>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/releases/${it.id}`}
                    className="font-mono text-xs text-primary hover:underline"
                    title={it.fileName}
                  >
                    v{it.version}
                  </Link>
                  <div className="text-[10px] text-muted-foreground">
                    {it.fileName}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs">
                  {formatSize(it.fileSizeBytes)}
                </td>
                <td className="px-3 py-2">
                  <ChannelBadge channel={it.channel} />
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="font-medium">{it.downloadCount}</span>
                  <span className="ml-1 text-muted-foreground">次</span>
                </td>
                <td className="px-3 py-2">
                  <ReleasesAdminTable
                    id={it.id}
                    initialStatus={it.status}
                    initialDisplayName={it.displayName}
                  />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {formatDate(it.releasedAt)}
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  <Link
                    href={`/admin/releases/${it.id}`}
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

      <p className="text-xs text-muted-foreground">
        提示：状态为{" "}
        <Badge variant="warning">隐藏</Badge> 的版本不会在{" "}
        <Link href="/downloads" className="text-primary hover:underline">
          /downloads
        </Link>{" "}
        公开页显示，但已下载的用户仍能访问 OSS 链接。
      </p>
    </div>
  );
}
