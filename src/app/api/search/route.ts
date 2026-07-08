import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listAllSkills } from "@/lib/skills-manager";
import { snippetToSearchResultItem } from "@/lib/snippets/search-result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SearchResultItem = {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

export type SearchResult = {
  articles: SearchResultItem[];
  spaces: SearchResultItem[];
  assets: SearchResultItem[];
  skills: SearchResultItem[];
  snippets: SearchResultItem[];
};

/**
 * 全局搜索：文章 / 空间 / 素材 / 技能 / 灵感。
 * 仅搜索标题/摘要/名称等 DB+内存字段，不读文章正文文件（避免逐篇 I/O）。
 * 关键词 < 2 字符或为空时返回空结果。
 */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const empty: SearchResult = {
    articles: [],
    spaces: [],
    assets: [],
    skills: [],
    snippets: [],
  };
  if (q.length < 2) {
    return NextResponse.json(empty);
  }
  // 大小写不敏感的子串匹配
  const match = (s: string | null | undefined) =>
    !!s && s.toLowerCase().includes(q.toLowerCase());

  const [articles, spaces, assets, skills, snippets] = await Promise.all([
    prisma.article.findMany({
      where: { trashed: false },
      select: { id: true, title: true, digest: true },
    }),
    prisma.space.findMany({
      where: { trashed: false },
      select: { id: true, name: true, description: true },
    }),
    prisma.asset.findMany({
      where: { trashed: false },
      select: { id: true, name: true, description: true, kind: true, url: true },
    }),
    listAllSkills(),
    prisma.snippet.findMany({
      where: { trashed: false },
      select: {
        id: true,
        title: true,
        content: true,
        kind: true,
        tagsJson: true,
      },
    }),
  ]);

  const result: SearchResult = {
    articles: articles
      .filter((a) => match(a.title) || match(a.digest))
      .slice(0, 20)
      .map((a) => ({
        id: a.id,
        title: a.title || "无标题文章",
        subtitle: a.digest ?? undefined,
        href: `/editor/${a.id}`,
      })),
    spaces: spaces
      .filter((s) => match(s.name) || match(s.description))
      .slice(0, 20)
      .map((s) => ({
        id: s.id,
        title: s.name,
        subtitle: s.description || undefined,
        href: `/spaces/${s.id}`,
      })),
    assets: assets
      .filter((a) => match(a.name) || match(a.description))
      .slice(0, 20)
      .map((a) => ({
        id: a.id,
        title: a.name,
        subtitle: a.description || a.kind,
        href: `/materials`,
      })),
    skills: skills
      .filter((s) => match(s.name) || match(s.description))
      .slice(0, 20)
      .map((s) => ({
        id: s.id,
        title: s.name,
        subtitle: `${s.source === "system" ? "系统" : "用户"}技能 · ${s.description}`,
        href: `/skills`,
      })),
    snippets: snippets
      .filter((s) => match(s.title) || match(s.content) || match(s.tagsJson))
      .slice(0, 20)
      .map((s) => snippetToSearchResultItem(s)),
  };

  return NextResponse.json(result);
}
