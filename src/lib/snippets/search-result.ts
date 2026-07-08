export type SnippetSearchInput = {
  id: string;
  title: string;
  content: string;
  kind: string;
  tagsJson: string;
};

export type SnippetSearchResultItem = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

const KIND_LABEL: Record<string, string> = {
  text: "文字",
  quote: "引用",
  link: "链接",
  image: "图文",
};

/** 素材块 → 全局搜索结果项。纯函数，不依赖 React / prisma。 */
export function snippetToSearchResultItem(
  s: SnippetSearchInput
): SnippetSearchResultItem {
  const kindLabel = KIND_LABEL[s.kind] ?? "灵感";
  const firstLine = s.content.split("\n")[0].slice(0, 60);
  const title = s.title || firstLine || "无标题灵感";
  const subtitle = `${kindLabel} · ${firstLine || title}`;
  return { id: s.id, title, subtitle, href: "/snippets" };
}
