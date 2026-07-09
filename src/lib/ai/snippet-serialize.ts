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

export type InlineSnippetRef = {
  id: string;
  token: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

/**
 * Inline composer mode:
 * textarea 中保留用户可读的 [[灵感：标题]] 占位符；发送前按正文顺序替换为
 * Agent tool-routing 能识别的 {{snippet:id}} marker。
 */
export function serializeInlineSnippetComposer(
  text: string,
  snippetRefs: InlineSnippetRef[]
): ComposerPayload {
  const refs = (snippetRefs ?? []).filter((ref) => ref.id && ref.token);
  if (refs.length === 0) return { message: text, snippetRefs: [] };

  const occurrences = refs.flatMap((ref) => {
    const indexes: Array<{ index: number; id: string }> = [];
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(ref.token, from);
      if (index === -1) break;
      indexes.push({ index, id: ref.id });
      from = index + ref.token.length;
    }
    return indexes;
  });

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of occurrences.sort((a, b) => a.index - b.index)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    ids.push(item.id);
  }
  if (ids.length === 0) return { message: text, snippetRefs: [] };

  let message = text;
  for (const ref of refs) {
    message = message.replace(
      new RegExp(escapeRegExp(ref.token), "g"),
      `{{snippet:${ref.id}}}`
    );
  }
  return { message, snippetRefs: ids };
}
