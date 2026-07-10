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
import { claudeAllowedTools } from "../../src/lib/ai/permission-engine";

function proposalTool() {
  const tool = INKPRESS_TOOLS.find(
    (item) => item.name === "propose_article_revision"
  );
  if (!tool) throw new Error("proposal tool not registered");
  return tool;
}

function readCurrentArticleTool() {
  const tool = INKPRESS_TOOLS.find(
    (item) => item.name === "read_current_article"
  );
  if (!tool) throw new Error("read_current_article tool not registered");
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

  it("requires a range read before accepting a full proposal for a truncated article", async () => {
    const longMarkdown = `${"a".repeat(12_000)}${"b".repeat(200)}`;
    const ctx = {
      target: {
        kind: "article",
        id: "article-1",
        title: "长文",
        markdown: longMarkdown,
        digest: "",
      },
      sessionId: "session-1",
    } as InkPressToolContext;

    const result = await proposalTool().execute(ctx, {
      title: "长文",
      markdown: `${longMarkdown}\n\n补充一段。`,
      summary: "改写长文",
    });

    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      code: "article-context-incomplete",
    });
  });

  it("exposes read_current_article ranges for oversized articles", async () => {
    const longMarkdown = `${"a".repeat(12_000)}${"b".repeat(200)}`;
    const tool = readCurrentArticleTool();
    const ctx = {
      target: {
        kind: "article",
        id: "article-1",
        title: "长文",
        markdown: longMarkdown,
        digest: "",
      },
      sessionId: "session-1",
    } as InkPressToolContext;

    expect(tool.inputSchema.start).toBeTruthy();
    expect(tool.inputSchema.end).toBeTruthy();
    expect(claudeAllowedTools()).toContain("mcp__inkpress__read_current_article");

    const result = await tool.execute(ctx, { start: 12_000, end: 12_200 });

    expect(result).toMatchObject({
      start: 12_000,
      end: 12_200,
      totalCharacters: 12_200,
    });
    expect((result as { markdown: string }).markdown).toBe("b".repeat(200));
  });

  it("accepts a full proposal for a truncated article after range reads cover the full article", async () => {
    const longMarkdown = `${"a".repeat(12_000)}${"b".repeat(200)}`;
    const ctx = {
      target: {
        kind: "article",
        id: "article-1",
        title: "长文",
        markdown: longMarkdown,
        digest: "",
      },
      sessionId: "session-1",
    } as InkPressToolContext;

    await readCurrentArticleTool().execute(ctx, { start: 0, end: longMarkdown.length });
    const result = await proposalTool().execute(ctx, {
      title: "长文",
      markdown: `${longMarkdown}\n\n补充一段。`,
      summary: "改写长文",
    });

    expect(create).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      mode: "proposal",
      proposalId: "proposal-1",
    });
  });
});
