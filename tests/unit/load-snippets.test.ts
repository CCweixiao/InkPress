import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above imports, so the fn must be declared via
// vi.hoisted to be referenceable inside the factory (vitest hoisting gotcha).
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { snippet: { findMany } },
}));

import { INKPRESS_TOOLS } from "../../src/lib/ai/tools/registry";
import type { InkPressToolContext } from "../../src/lib/ai/tools/registry";

const ctx = {} as InkPressToolContext;

function loadSnippets() {
  const tool = INKPRESS_TOOLS.find((t) => t.name === "load_snippets");
  if (!tool) throw new Error("load_snippets tool not registered");
  return tool;
}

describe("load_snippets tool", () => {
  beforeEach(() => findMany.mockReset());

  it("已注册且 permission=allow, category=memory", () => {
    const t = loadSnippets();
    expect(t.permission).toBe("allow");
    expect(t.category).toBe("memory");
  });

  it("execute 按 ids 查询未删除素材，select 精确字段，过滤 trashed", async () => {
    findMany.mockResolvedValue([{ id: "cl1" }]);
    await loadSnippets().execute(ctx, { ids: ["cl1", "cl2"] });
    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { in: ["cl1", "cl2"] }, trashed: false });
    expect(arg.select).toEqual({
      id: true,
      title: true,
      content: true,
      kind: true,
      imageUrl: true,
      quoteSource: true,
      linkUrl: true,
      linkTitle: true,
      tagsJson: true,
    });
  });

  it("execute 原样透传 findMany 返回值", async () => {
    const rows = [{ id: "cl1", title: "t" }];
    findMany.mockResolvedValue(rows);
    const out = await loadSnippets().execute(ctx, { ids: ["cl1"] });
    expect(out).toBe(rows);
  });
});
