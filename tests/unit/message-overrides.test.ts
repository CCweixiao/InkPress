import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { replaceLastUserText } from "../../src/lib/ai/message-overrides";

describe("replaceLastUserText", () => {
  it("只替换最后一条用户消息，保留可见消息之外的历史", () => {
    const messages = [
      { id: "1", role: "user", parts: [{ type: "text", text: "旧消息" }] },
      { id: "2", role: "assistant", parts: [{ type: "text", text: "回复" }] },
      { id: "3", role: "user", parts: [{ type: "text", text: "可见消息" }] },
    ] as UIMessage[];

    const next = replaceLastUserText(messages, "内部 {{snippet:a}} 消息");

    expect((next[0].parts[0] as { text: string }).text).toBe("旧消息");
    expect((next[2].parts[0] as { text: string }).text).toBe(
      "内部 {{snippet:a}} 消息"
    );
    expect((messages[2].parts[0] as { text: string }).text).toBe("可见消息");
  });
});
