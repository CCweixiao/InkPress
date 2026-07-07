import type { MetadataRoute } from "next";
import { flattenGuideItems, getGuideManifest } from "@/lib/guide";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://inkpress.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const manifest = await getGuideManifest();
  const defaultSlug = manifest.sections[0]?.items[0]?.slug;
  const guideItems = flattenGuideItems(manifest).filter(
    (item) => item.slug !== defaultSlug
  );

  return [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/guide`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    ...guideItems.map((item) => ({
      url: `${siteUrl}/guide/${item.slug}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
