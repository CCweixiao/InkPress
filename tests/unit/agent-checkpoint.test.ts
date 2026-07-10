import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { findAssistantCheckpointBefore } from "../../src/lib/ai/agent-checkpoint";

function message(
  id: string,
  role: UIMessage["role"],
  checkpoint?: string
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text: id }],
    ...(checkpoint ? { metadata: { claudeAgentMessageUuid: checkpoint } } : {}),
  } as UIMessage;
}

describe("findAssistantCheckpointBefore", () => {
  it("uses the nearest assistant checkpoint before an edited user message", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", "assistant-uuid-1"),
      message("u2", "user"),
      message("a2", "assistant", "assistant-uuid-2"),
      message("u3", "user"),
    ];

    expect(findAssistantCheckpointBefore(messages, 4)).toBe("assistant-uuid-2");
    expect(findAssistantCheckpointBefore(messages, 2)).toBe("assistant-uuid-1");
  });

  it("never uses a checkpoint after the edited message", () => {
    const messages = [
      message("u1", "user"),
      message("a1", "assistant", "assistant-uuid-later"),
    ];
    expect(findAssistantCheckpointBefore(messages, 0)).toBeUndefined();
  });
});
