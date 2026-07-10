import type { UIMessage } from "ai";

/** Merge a refreshed newest page into loaded history without importing server DB code. */
export function mergeFinishedMessages(
  existing: UIMessage[],
  newest: UIMessage[]
): UIMessage[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of newest) byId.set(message.id, message);
  const result = existing
    .map((message) => byId.get(message.id))
    .filter((message): message is UIMessage => Boolean(message));
  const existingIds = new Set(existing.map((message) => message.id));
  for (const message of newest) {
    if (!existingIds.has(message.id)) result.push(message);
  }
  return result;
}
