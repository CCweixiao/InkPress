import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { getReleaseById, CHANNEL_META, PLATFORM_LABELS } from "@/lib/release/service";
import { ReleaseEditForm } from "@/components/releases/release-edit-form";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import type { ReleaseChannel, ReleasePlatform } from "@/lib/validation/schemas";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function DetailRow({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3 border-b px-3 py-2 text-sm last:border-b-0">
      <div className="w-28 shrink-0 text-xs uppercase text-muted-foreground">
        {label}
      </div>
      <div className={mono ? "font-mono text-xs break-all" : "min-w-0 flex-1"}>
        {children}
      </div>
    </div>
  );
}

export default async function ReleaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  let release;
  try {
    release = await getReleaseById(id);
  } catch {
    notFound();
  }

  const channelMeta = CHANNEL_META[release.channel as ReleaseChannel];
  const platformLabel = PLATFORM_LABELS[release.platform as ReleasePlatform];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/releases"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          返回版本列表
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">
            {release.displayName}
          </h1>
          <Badge variant={channelMeta?.tone ?? "secondary"}>
            {channelMeta?.label ?? release.channel}
          </Badge>
          <Badge variant={release.status === "PUBLISHED" ? "success" : "warning"}>
            {release.status === "PUBLISHED" ? "公开" : "隐藏"}
          </Badge>
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {release.packageName} · {release.platform} · v{release.version}
        </p>
      </div>

      {/* 文件信息 + 计数（只读，CI 写入） */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border">
          <header className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            文件信息（CI 写入，不可编辑）
          </header>
          <div>
            <DetailRow label="文件名" mono>
              {release.fileName}
            </DetailRow>
            <DetailRow label="大小">
              {formatSize(release.fileSizeBytes)}{" "}
              <span className="text-muted-foreground">
                ({release.fileSizeBytes.toLocaleString()} B)
              </span>
            </DetailRow>
            <DetailRow label="SHA256" mono>
              {release.fileHashSha256 ?? "—"}
            </DetailRow>
            <DetailRow label="OSS 直链" mono>
              <a
                href={release.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                打开
              </a>
            </DetailRow>
            <DetailRow label="平台">
              {platformLabel ?? release.platform}
            </DetailRow>
          </div>
        </section>

        <section className="rounded-lg border">
          <header className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            状态与计数
          </header>
          <div>
            <DetailRow label="下载次数">
              <span className="inline-flex items-center gap-1 text-base font-semibold">
                <Download className="h-3.5 w-3.5 text-primary" />
                {release.downloadCount.toLocaleString()}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                次（仅计通过 /api/releases/[id]/download 跳转的访问）
              </span>
            </DetailRow>
            <DetailRow label="来源">
              {release.source === "ci" ? "CI 自动登记" : "管理员手动"}
            </DetailRow>
            <DetailRow label="发布时间">
              {formatDate(release.releasedAt)}
            </DetailRow>
            <DetailRow label="创建时间">
              {formatDate(release.createdAt)}
            </DetailRow>
            <DetailRow label="最后更新">
              {formatDate(release.updatedAt)}
            </DetailRow>
            <DetailRow label="记录 ID" mono>
              {release.id}
            </DetailRow>
          </div>
        </section>
      </div>

      {/* 可编辑区 */}
      <section className="rounded-lg border p-4">
        <header className="mb-4 border-b pb-2">
          <h2 className="text-sm font-semibold">编辑展示信息</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            修改 changelog / 亮点 / 通道 / 状态等。文件信息请通过 CI 重新登记覆盖。
          </p>
        </header>
        <ReleaseEditForm
          id={release.id}
          initialDisplayName={release.displayName}
          initialLogoUrl={release.logoUrl ?? ""}
          initialChannel={release.channel as ReleaseChannel}
          initialStatus={release.status as "PUBLISHED" | "HIDDEN"}
          initialChangelogMarkdown={release.changelogMarkdown ?? ""}
          initialHighlights={
            (() => {
              try {
                const parsed = JSON.parse(release.highlightsJson) as unknown;
                return Array.isArray(parsed)
                  ? parsed.filter((x): x is string => typeof x === "string")
                  : [];
              } catch {
                return [];
              }
            })()
          }
          packageLabel={`${release.displayName} · ${release.platform} · v${release.version}`}
        />
      </section>
    </div>
  );
}
