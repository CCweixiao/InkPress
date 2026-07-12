import { describe, expect, it } from "vitest";
import {
  dedupeAdjacentAssistantTextParts,
  dedupeAssistantDisplayParts,
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

  it("collapses mirrored text even when data parts are inserted between frames", () => {
    const parts = dedupeAssistantDisplayParts([
      { type: "text", text: "已读取完整正文，并准备综合结果。" },
      { type: "data-turn-usage", id: "turn-usage", data: { totalTokens: 10 } },
      { type: "text", text: " 已读取完整正文，并准备综合结果。\n" },
    ]);

    expect(parts).toEqual([
      { type: "text", text: "已读取完整正文，并准备综合结果。" },
      { type: "data-turn-usage", id: "turn-usage", data: { totalTokens: 10 } },
    ]);
  });

  it("collapses duplicate tool approval cards for the same grant", () => {
    const approval = {
      type: "data-tool-approval",
      data: { grantId: "grant-1", toolName: "web_fetch" },
    };

    expect(dedupeAssistantDisplayParts([approval, approval])).toEqual([approval]);
  });

  it("collapses duplicate tool outputs with the same call id and state", () => {
    const output = {
      type: "tool-output-available",
      toolCallId: "tool-1",
      toolName: "web_fetch",
      state: "output-available",
      output: { text: "ok" },
    };

    expect(dedupeAssistantDisplayParts([output, output])).toEqual([output]);
  });
});
