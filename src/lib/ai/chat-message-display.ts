/**
 * Some providers mirror a completed assistant frame after its streamed frame.
 * Those are distinct UIMessage parts, so render-time protection is needed to
 * avoid showing the same conclusion twice.
 */
export function dedupeAdjacentAssistantTextParts<
  T extends { type?: unknown; text?: unknown },
>(parts: readonly T[]): T[] {
  const result: T[] = [];
  let previousTextKey: string | null = null;

  for (const part of parts) {
    if (part.type !== "text" || typeof part.text !== "string") {
      previousTextKey = null;
      result.push(part);
      continue;
    }
    const key = part.text.trim().replace(/\s+/g, " ");
    if (key && key === previousTextKey) continue;
    result.push(part);
    previousTextKey = key || null;
  }
  return result;
}
