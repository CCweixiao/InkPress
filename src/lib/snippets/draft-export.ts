import { snippetToMarkdown, type SnippetLike } from "@/lib/ai/snippet-markdown";

/** 按序把素材拼成草稿正文，--- 分隔；过滤空片段。 */
export function composeDraftBody(snippets: SnippetLike[]): string {
  return snippets
    .map(snippetToMarkdown)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/** 首条素材 title → content 首行（≤30 字）→ 「素材草稿」。 */
export function deriveDraftTitle(snippets: SnippetLike[]): string {
  const first = snippets[0];
  if (!first) return "素材草稿";
  const t = (first.title ?? "").trim();
  if (t) return t.slice(0, 30);
  const c = ((first.content ?? "").trim().split("\n")[0] ?? "").trim();
  if (c) return c.slice(0, 30);
  return "素材草稿";
}
