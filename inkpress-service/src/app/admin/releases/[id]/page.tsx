import { requireAdmin } from "@/lib/auth/admin-guard";
import { getVersionById } from "@/lib/release/service";
import { ReleaseEditForm } from "@/components/releases/release-edit-form";
import { AssetManager } from "@/components/releases/asset-manager";

export default async function AdminReleaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const version = await getVersionById(id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">
          {version.displayName}{" "}
          <span className="font-mono text-base text-muted-foreground">v{version.version}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {version.packageName} · {version.source} · {version.assets.length} 个架构包
        </p>
      </div>

      <ReleaseEditForm
        id={version.id}
        initialDisplayName={version.displayName}
        initialLogoUrl={version.logoUrl ?? ""}
        initialChannel={version.channel as "stable" | "beta" | "rc" | "snapshot"}
        initialStatus={version.status as "PUBLISHED" | "HIDDEN"}
        initialChangelogMarkdown={version.changelogMarkdown ?? ""}
        initialHighlights={JSON.parse(version.highlightsJson)}
        packageLabel={`${version.displayName} v${version.version}`}
      />

      <div className="border-t pt-6">
        <h2 className="mb-3 text-lg font-semibold">架构包</h2>
        <AssetManager versionId={version.id} initialAssets={version.assets} />
      </div>
    </div>
  );
}
