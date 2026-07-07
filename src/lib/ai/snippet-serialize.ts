/**
 * Tray 托盘模式的 Composer 序列化。
 *
 * refs 为空 → message = 原文（普通消息）。
 * refs 非空 → message = 原文 + 标记段（HTML 注释做可清理分隔 + 按序 {{snippet:id}}）。
 * agent 端按既有 tool-routing 解析 {{snippet:id}} 并调 load_snippets；system prompt 禁止回显标记。
 *
 * 入参只需 id 列表：标记段只用 id，chip 的展示文本（displayText）是组件层关注点，不进序列化。
 */
export type ComposerPayload = {
  message: string;
  snippetRefs: string[];
};

const SNIPPET_REFS_MARKER = "<!-- snippet-refs -->";

export function serializeComposer(
  text: string,
  snippetRefs: string[]
): ComposerPayload {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of snippetRefs ?? []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) return { message: text, snippetRefs: [] };
  const markers = ids.map((id) => `{{snippet:${id}}}`).join(" ");
  const body = text.replace(/\n+$/, "");
  const message = body.trim().length
    ? `${body}\n\n${SNIPPET_REFS_MARKER}\n${markers}`
    : `${SNIPPET_REFS_MARKER}\n${markers}`;
  return { message, snippetRefs: ids };
}
