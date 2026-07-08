/**
 * @ 灵感引用 —— 检测与过滤纯函数（与 slash-commands.tsx 数据层平行）。
 * 触发逻辑在 ChatComposer 组件层调用；这里只做无副作用的判定，便于单测。
 */

/** 对齐 /api/snippets/search 返回的精简字段（route.ts items[]）。 */
export type SnippetSearchItem = {
  id: string;
  title: string;
  summary: string;
  kind: string;
  tags: string[];
  imageUrl: string | null;
  color: string | null;
  updatedAt: string;
};

export type AtQueryResult = {
  /** 命中的 @ 在 input 中的下标。 */
  triggerStart: number;
  /** caret 位置（待删除区间的右端）。 */
  triggerEnd: number;
  /** @ 之后、caret 之前的查询文本。 */
  query: string;
};

/**
 * 检测 caret 之前最近的、且其后到 caret 无空白的 @。
 * composition 中（中文输入法组字）、无 @、@ 与 caret 间含空白 → null。
 */
export function atQuery(
  input: string,
  caretPos: number,
  isComposing: boolean
): AtQueryResult | null {
  if (isComposing) return null;
  const before = input.slice(0, caretPos);
  const atIdx = before.lastIndexOf("@");
  if (atIdx === -1) return null;
  const query = before.slice(atIdx + 1);
  if (/[\s\n]/.test(query)) return null;
  return { triggerStart: atIdx, triggerEnd: caretPos, query };
}

/** 按 query 模糊匹配 title/summary/tags（大小写不敏感子串）。空 query 返回全部。 */
export function filterSnippets(
  items: SnippetSearchItem[],
  query: string
): SnippetSearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.summary.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
  );
}
