import type { UIMessage } from "ai";

/** Return the nearest resumable assistant checkpoint strictly before a message. */
export function findAssistantCheckpointBefore(
  messages: UIMessage[],
  messageIndex: number
): string | undefined {
  for (let index = Math.min(messageIndex - 1, messages.length - 1); index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const metadata = (message as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== "object") continue;
    const checkpoint = (metadata as { claudeAgentMessageUuid?: unknown })
      .claudeAgentMessageUuid;
    if (typeof checkpoint === "string" && checkpoint) return checkpoint;
  }
  return undefined;
}
