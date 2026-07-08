/**
 * 多标签 AND 筛选谓词。activeTags 为空 → true。
 * 大小写敏感。纯函数，无副作用。
 *
 * 注：标签计数（原 collectUniqueTags）已迁移至服务端 tag-repo.countTagsByUsage
 *（P4-21 关系表化后用 SQL _count 聚合）。
 */
export function snippetMatchesAllTags(
  snippetTags: string[],
  activeTags: string[]
): boolean {
  return activeTags.every((t) => snippetTags.includes(t));
}
