import type { UIMessage } from "ai";

export function replaceLastUserText(
  messages: UIMessage[],
  overrideText: string | null | undefined
): UIMessage[] {
  if (!overrideText?.trim()) return messages;
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const message = next[i];
    if (message.role !== "user") continue;
    next[i] = {
      ...message,
      parts: (message.parts ?? []).map((part) =>
        (part as { type?: string }).type === "text"
          ? { ...part, text: overrideText }
          : part
      ),
    };
    return next;
  }
  return messages;
}
