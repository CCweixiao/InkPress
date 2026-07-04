import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { GuideView } from "@/components/guide/guide-view";
import { flattenGuideItems, getGuideDocument, getGuideManifest } from "@/lib/guide";
import { renderGuideMarkdown } from "@/lib/guide-markdown";

type Params = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const manifest = await getGuideManifest();
  return flattenGuideItems(manifest).map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const manifest = await getGuideManifest();
  const item = flattenGuideItems(manifest).find((entry) => entry.slug === slug);
  if (!item) return {};
  return {
    title: `${item.title} · InkPress 使用指引`,
    description: item.description ?? "InkPress 产品使用手册。",
    alternates: {
      canonical:
        item.slug === manifest.sections[0]?.items[0]?.slug
          ? "/guide"
          : `/guide/${item.slug}`,
    },
  };
}

export default async function GuideSlugPage({ params }: Params) {
  const { slug } = await params;
  const manifest = await getGuideManifest();
  if (slug === manifest.sections[0]?.items[0]?.slug) {
    redirect("/guide");
  }
  const [session, guide] = await Promise.all([auth(), getGuideDocument(slug)]);
  if (!guide) notFound();

  return (
    <GuideView
      manifest={guide.manifest}
      current={guide.item}
      html={renderGuideMarkdown(guide.markdown)}
      isLoggedIn={Boolean(session?.user?.id)}
      email={session?.user?.email ?? null}
      role={session?.user?.role ?? null}
    />
  );
}
