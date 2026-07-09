import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    agentArticleProposal: { create },
  },
}));

import {
  INKPRESS_TOOLS,
  type InkPressToolContext,
} from "../../src/lib/ai/tools/registry";

function proposalTool() {
  const tool = INKPRESS_TOOLS.find(
    (item) => item.name === "propose_article_revision"
  );
  if (!tool) throw new Error("proposal tool not registered");
  return tool;
}

describe("propose_article_revision", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({
      id: "proposal-1",
      status: "pending",
      summary: "生成首稿",
      title: "标题",
    });
  });

  it("creates a reviewable proposal even when the editor is empty", async () => {
    const ctx = {
      target: {
        kind: "article",
        id: "article-1",
        title: "",
        markdown: "",
        digest: "",
      },
      sessionId: "session-1",
    } as InkPressToolContext;

    const result = await proposalTool().execute(ctx, {
      title: "标题",
      markdown: "# 首稿",
      digest: "摘要",
      summary: "生成首稿",
    });

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].data.baseMarkdown).toBe("");
    expect(result).toMatchObject({
      mode: "proposal",
      proposalId: "proposal-1",
      status: "pending",
    });
  });
});
