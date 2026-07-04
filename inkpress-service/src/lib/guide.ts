import { promises as fs } from "node:fs";
import path from "node:path";

export type GuideManifest = {
  sections: GuideSection[];
};

export type GuideSection = {
  title: string;
  items: GuideItem[];
};

export type GuideItem = {
  slug: string;
  title: string;
  description?: string;
};

const GUIDE_DIR = path.join(process.cwd(), "docs", "guide");
const MANIFEST_PATH = path.join(GUIDE_DIR, "manifest.json");

export async function getGuideManifest(): Promise<GuideManifest> {
  const raw = await fs.readFile(MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(raw) as GuideManifest;
  return {
    sections: parsed.sections.map((section) => ({
      title: section.title,
      items: section.items.map((item) => ({
        slug: item.slug,
        title: item.title,
        description: item.description,
      })),
    })),
  };
}

export function flattenGuideItems(manifest: GuideManifest): GuideItem[] {
  return manifest.sections.flatMap((section) => section.items);
}

export async function getGuideDocument(slug?: string) {
  const manifest = await getGuideManifest();
  const items = flattenGuideItems(manifest);
  const item = slug ? items.find((entry) => entry.slug === slug) : items[0];
  if (!item) return null;
  const markdown = await fs.readFile(path.join(GUIDE_DIR, `${item.slug}.md`), "utf8");
  return { manifest, item, markdown };
}
