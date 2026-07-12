import { describe, expect, it } from "vitest";
import { dedupeAdjacentAssistantTextParts } from "../../src/lib/ai/chat-message-display";

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
});
