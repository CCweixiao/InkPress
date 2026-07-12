/**
 * Some providers mirror a completed assistant frame after its streamed frame.
 * Those are distinct UIMessage parts, so render-time protection is needed to
 * avoid showing the same conclusion twice.
 */
type DisplayPartLike = {
  type?: unknown;
  text?: unknown;
  id?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  state?: unknown;
  data?: unknown;
};

function normalizedTextKey(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function objectField(value: unknown, field: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[field]
    : undefined;
}

function stableDisplayPartKey(part: DisplayPartLike): string | null {
  const type = typeof part.type === "string" ? part.type : "";
  const data = part.data;
  const topLevelId = typeof part.id === "string" && part.id ? part.id : "";

  if (type === "data-tool-approval") {
    const grantId = objectField(data, "grantId");
    return typeof grantId === "string" && grantId
      ? `${type}:${grantId}`
      : null;
  }
  if (type === "data-code-source-approval") {
    const id = objectField(data, "id");
    return typeof id === "string" && id ? `${type}:${id}` : null;
  }
  if (type === "data-web-source" || type === "source-url") {
    const url = objectField(data, "url") ?? objectField(part, "url");
    return typeof url === "string" && url ? `${type}:${url}` : null;
  }
  if (type.startsWith("data-") && topLevelId) {
    return `${type}:${topLevelId}`;
  }
  if (type === "dynamic-tool" || type.startsWith("tool-")) {
    const toolCallId =
      typeof part.toolCallId === "string" && part.toolCallId
        ? part.toolCallId
        : "";
    const state = typeof part.state === "string" ? part.state : "";
    if (!toolCallId || !state) return null;
    return `${type}:${toolCallId}:${state}`;
  }
  return null;
}

export function dedupeAssistantDisplayParts<T extends DisplayPartLike>(
  parts: readonly T[]
): T[] {
  const result: T[] = [];
  let previousTextKey: string | null = null;
  const seenLongText = new Set<string>();
  const seenStableParts = new Set<string>();

  for (const part of parts) {
    if (part.type !== "text" || typeof part.text !== "string") {
      previousTextKey = null;
      const stableKey = stableDisplayPartKey(part);
      if (stableKey) {
        if (seenStableParts.has(stableKey)) continue;
        seenStableParts.add(stableKey);
      }
      result.push(part);
      continue;
    }
    const key = normalizedTextKey(part.text);
    if (key && key === previousTextKey) continue;
    // 完整结果帧有时会在工具/数据 part 之后再次镜像同一段文本；
    // 只对较长文本做非相邻去重，避免误删用户有意重复的短句。
    if (key.length >= 16) {
      if (seenLongText.has(key)) continue;
      seenLongText.add(key);
    }
    result.push(part);
    previousTextKey = key || null;
  }
  return result;
}

export const dedupeAdjacentAssistantTextParts = dedupeAssistantDisplayParts;
