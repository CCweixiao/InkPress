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

type AssistantTextMessage = {
  role?: unknown;
  parts?: readonly { type?: unknown; text?: unknown }[];
};

function pureTextMessageKey(message: AssistantTextMessage): string | null {
  if (message.role !== "assistant" || !message.parts?.length) return null;
  if (
    message.parts.some(
      (part) => part.type !== "text" || typeof part.text !== "string"
    )
  ) {
    return null;
  }
  const text = message.parts
    .map((part) => String(part.text))
    .join("")
    .trim()
    .replace(/\s+/g, " ");
  return text || null;
}

/**
 * The mirror can also arrive as a second UIMessage, rather than a second part
 * in the same message.  Hide only an immediately repeated pure-text assistant
 * message.  Any user message, reasoning, tool, or data event resets the
 * comparison boundary.
 */
export function dedupeConsecutiveAssistantMessages<T extends AssistantTextMessage>(
  messages: readonly T[]
): T[] {
  const result: T[] = [];
  let previousTextKey: string | null = null;

  for (const message of messages) {
    const key = pureTextMessageKey(message);
    if (key && key === previousTextKey) continue;
    result.push(message);
    previousTextKey = key;
  }
  return result;
}
