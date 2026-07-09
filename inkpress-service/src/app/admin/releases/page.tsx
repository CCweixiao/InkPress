import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { listAllVersions, CHANNEL_META } from "@/lib/release/service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { ReleaseChannel } from "@/lib/validation/schemas";

function ChannelBadge({ channel }: { channel: string }) {
  const meta = CHANNEL_META[channel as ReleaseChannel];
  if (!meta) return <Badge variant="outline">{channel}</Badge>;
  return <Badge variant={meta.tone}>{meta.label}</Badge>;
}

export default async function AdminReleasesPage() {
  await requireAdmin();
  const { items } = await listAllVersions({ page: 1, pageSize: 100 });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">软件版本</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            版本中心。GH Action 推 tag 自动同步版本元信息，管理员可编辑、上传架构包。
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/releases/new">+ 新建版本</Link>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">版本</th>
              <th className="px-3 py-2">展示名</th>
              <th className="px-3 py-2">通道</th>
              <th className="px-3 py-2">架构包</th>
              <th className="px-3 py-2">下载总量</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">来源</th>
              <th className="px-3 py-2">发布时间</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  暂无版本。推送 <code className="font-mono">v*</code> tag 后 GH Action 会自动同步，
                  或点击「新建版本」手动创建。
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/admin/releases/${it.id}`} className="font-mono text-xs text-primary hover:underline">
                    v{it.version}
                  </Link>
                </td>
                <td className="px-3 py-2">{it.displayName}</td>
                <td className="px-3 py-2"><ChannelBadge channel={it.channel} /></td>
                <td className="px-3 py-2 text-xs">
                  {it.assetCount === 0 ? (
                    <span className="text-amber-600">待上传</span>
                  ) : (
                    <span>{it.assetCount}</span>
                  )}
                  {it.assets.length > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      {it.assets.map((a) => `${a.os}-${a.arch}`).join(", ")}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="font-medium">{it.downloadCount}</span>
                  <span className="ml-1 text-muted-foreground">次</span>
                </td>
                <td className="px-3 py-2">
                  <Badge variant={it.status === "PUBLISHED" ? "default" : "warning"}>
                    {it.status === "PUBLISHED" ? "公开" : "隐藏"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{it.source}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(it.releasedAt)}</td>
                <td className="px-3 py-2 text-right text-xs">
                  <Link href={`/admin/releases/${it.id}`} className="text-primary hover:underline">详情</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
