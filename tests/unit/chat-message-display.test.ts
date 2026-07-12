import { describe, expect, it } from "vitest";
import {
  dedupeAdjacentAssistantTextParts,
  dedupeConsecutiveAssistantMessages,
} from "../../src/lib/ai/chat-message-display";

describe("dedupeAdjacentAssistantTextParts", () => {
  it("collapses a mirrored consecutive conclusion", () => {
    const parts = dedupeAdjacentAssistantTextParts([
      { type: "text", text: "已读取完整正文。" },
      { type: "text", text: " 已读取完整正文。\n" },
      { type: "reasoning", text: "准备提交提案" },
      { type: "text", text: "已读取完整正文。" },
    ]);
    expect(parts).toEqual([
      { type: "text", text: "已读取完整正文。" },
      { type: "reasoning", text: "准备提交提案" },
      { type: "text", text: "已读取完整正文。" },
    ]);
  });

  it("collapses a mirrored consecutive assistant message", () => {
    const messages = dedupeConsecutiveAssistantMessages([
      { id: "thought", role: "assistant", parts: [{ type: "reasoning", text: "思考" }] },
      { id: "first", role: "assistant", parts: [{ type: "text", text: "准备开始研究。" }] },
      { id: "mirror", role: "assistant", parts: [{ type: "text", text: " 准备开始研究。\n" }] },
      { id: "tool", role: "assistant", parts: [{ type: "tool-x", text: "" }] },
      { id: "later", role: "assistant", parts: [{ type: "text", text: "准备开始研究。" }] },
    ]);

    expect(messages.map((message) => message.id)).toEqual([
      "thought",
      "first",
      "tool",
      "later",
    ]);
  });
});
