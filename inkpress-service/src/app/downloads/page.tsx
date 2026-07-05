import type { Metadata } from "next";
import { auth } from "@/auth";
import { listPublishedReleases } from "@/lib/release/service";
import { DownloadsPage, type DownloadsPageProps } from "@/components/downloads/downloads-page";
import { notFound } from "next/navigation";

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
 * 未发布过任何版本时返回 notFound（避免展示空白页）。
 */
export default async function DownloadsRoutePage() {
  const [session, data] = await Promise.all([
    auth(),
    listPublishedReleases("inkpress"),
  ]);

  if (!data) notFound();

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
