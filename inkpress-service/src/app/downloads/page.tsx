import type { Metadata } from "next";
import { auth } from "@/auth";
import { listPublishedReleases } from "@/lib/release/service";
import { DownloadsPage, type DownloadsPageProps } from "@/components/downloads/downloads-page";
import { ServiceHeader } from "@/components/navigation/service-header";

export const metadata: Metadata = {
  title: "下载 InkPress · macOS / Windows 桌面版",
  description:
    "下载 InkPress 桌面版，支持 macOS Apple Silicon、Intel 芯片与 Windows。一键安装，立即开始你的 AI 公众号写作之旅。",
  alternates: { canonical: "/downloads" },
};

/**
 * /downloads — 公开下载页。
 *
 * 数据从 SoftwareRelease 表读取（status=PUBLISHED，按平台分组取最新）。
 * 未发布过任何版本时展示「即将上线」空态，避免直接 404 让访问者扑空。
 */
export default async function DownloadsRoutePage() {
  const [session, data] = await Promise.all([
    auth(),
    listPublishedReleases("inkpress"),
  ]);

  const isLoggedIn = Boolean(session?.user?.id);
  const email = session?.user?.email ?? null;
  const role = session?.user?.role ?? null;

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
        <ServiceHeader isLoggedIn={isLoggedIn} email={email} role={role} />
        <section className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            即将上线
          </div>
          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            桌面版即将上线
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground">
            InkPress 桌面客户端的首个公开版本正在最后冲刺，稍后会在这里提供 macOS / Windows 安装包下载。敬请期待。
          </p>
        </section>
      </div>
    );
  }

  const props: DownloadsPageProps = {
    isLoggedIn: Boolean(session?.user?.id),
    email: session?.user?.email ?? null,
    role: session?.user?.role ?? null,
    packageName: data.packageName,
    displayName: data.displayName,
    logoUrl: data.logoUrl,
    latestVersion: data.latestVersion,
    releasedAt: data.latestVersion ? data.releasedAt.toISOString() : null,
    changelogMarkdown: data.changelogMarkdown,
    highlights: data.highlights,
    platforms: data.platforms.map((p) => ({
      platform: p.platform,
      label: p.label,
      version: p.release.version,
      fileName: p.release.fileName,
      fileSizeBytes: p.release.fileSizeBytes,
      downloadUrl: p.release.downloadUrl,
      releasedAt: p.release.releasedAt.toISOString(),
    })),
    history: data.history?.map((h) => ({
      platform: h.platform,
      platformLabel: h.platformLabel,
      version: h.version,
      fileName: h.fileName,
      fileSizeBytes: h.fileSizeBytes,
      downloadUrl: h.downloadUrl,
      releasedAt: h.releasedAt.toISOString(),
      changelogMarkdown: h.changelogMarkdown,
    })),
  };

  return <DownloadsPage {...props} />;
}
