import { describe, expect, it } from "vitest";
import {
  isArticleProposalPart,
  moveProposalPartsToEnd,
} from "../../src/lib/ai/message-order";

describe("agent message presentation order", () => {
  it("places article proposal review after the final reasoning summary", () => {
    const proposal = {
      type: "tool-propose_article_revision",
      output: { proposalId: "proposal-1" },
    };
    const summary = { type: "reasoning", text: "已完成改写并总结本轮调整。" };

    expect(moveProposalPartsToEnd([proposal, summary])).toEqual([
      summary,
      proposal,
    ]);
  });

  it("recognizes dynamic and static proposal tools only", () => {
    expect(
      isArticleProposalPart({
        type: "dynamic-tool",
        toolName: "propose_article_revision",
      })
    ).toBe(true);
    expect(isArticleProposalPart({ type: "tool-load_snippets" })).toBe(false);
  });
});
