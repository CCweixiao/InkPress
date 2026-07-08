/**
 * 多标签 AND 筛选谓词。activeTags 为空 → true。
 * 大小写敏感。纯函数，无副作用。
 */
export function snippetMatchesAllTags(
  snippetTags: string[],
  activeTags: string[]
): boolean {
  return activeTags.every((t) => snippetTags.includes(t));
}

/**
 * 从一批 snippet 的 tagsJson 聚合去重 + 计数。
 * 按 count 降序、name 升序兜底。容错：非法 JSON / 非数组 / 非字符串 / 空串 全跳过。
 * 客户端安全：不 import 任何服务端模块。
 */
export function collectUniqueTags(
  snippets: { tagsJson: string | null }[]
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of snippets) {
    let tags: unknown;
    try {
      tags = JSON.parse(s.tagsJson ?? "[]");
    } catch {
      continue;
    }
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      if (typeof tag === "string" && tag.length > 0) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
