import { describe, expect, it } from "vitest";
import {
  PART_RENDERERS,
  aggregateParts,
} from "../../src/components/editor/WritingAssistant";

/**
 * 验证 part 渲染注册表：
 * 1. 每种 part 恰好命中一个 renderer（无重叠、无遗漏）；
 * 2. 特化 matcher 在通用 tool matcher 之前（工具 part 不会被 data-* 抢走，反之亦然）。
 * 只测 match() 纯逻辑，不渲染 JSX。
 */

type Fixture = { name: string; part: Record<string, unknown> };

const fixtures: Fixture[] = [
  { name: "text", part: { type: "text", text: "hi" } },
  { name: "reasoning", part: { type: "reasoning", text: "思考" } },
  {
    name: "code-source-approval",
    part: { type: "data-code-source-approval", data: { id: "1" } },
  },
  {
    name: "code-source-ready",
    part: { type: "data-code-source-ready", data: { displayName: "x" } },
  },
  { name: "git-range", part: { type: "data-git-range", data: {} } },
  { name: "commit-evidence", part: { type: "data-commit-evidence", data: {} } },
  {
    name: "change-evidence-summary",
    part: { type: "data-change-evidence-summary", data: {} },
  },
  {
    name: "code-explore-step",
    part: { type: "data-code-explore-step", data: {} },
  },
  {
    name: "project-snapshot",
    part: { type: "data-project-snapshot", data: {} },
  },
  {
    name: "source-evidence",
    part: { type: "data-source-evidence", data: {} },
  },
  { name: "source-url", part: { type: "source-url", url: "https://x" } },
  { name: "agent-step", part: { type: "data-agent-step", data: {} } },
  { name: "context-usage", part: { type: "data-context-usage", data: {} } },
  {
    name: "dynamic-tool",
    part: { type: "dynamic-tool", toolName: "web_search" },
  },
  { name: "tool-prefix", part: { type: "tool-foo" } },
];

describe("agent part 渲染注册表", () => {
  for (const fixture of fixtures) {
    it(`${fixture.name} 恰好命中一个 renderer`, () => {
      const matched = PART_RENDERERS.filter((r) => r.match(fixture.part));
      expect(matched.length, `${fixture.name} 应唯一命中`).toBe(1);
    });
  }

  it("data-* part 不会被通用 tool renderer 误命中", () => {
    // 通用 tool renderer = 命中 tool-* / dynamic-tool 的那条（注册表末尾）。
    const toolRenderer = PART_RENDERERS.find((r) => r.match({ type: "tool-foo" }));
    expect(toolRenderer?.match({ type: "data-git-range", data: {} })).toBe(false);
  });

  it("无 type 的未知 part 不命中任何 renderer", () => {
    const matched = PART_RENDERERS.filter((r) => r.match({ foo: "bar" }));
    expect(matched.length).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// aggregateParts：工具调用分组聚合
// ────────────────────────────────────────────────────────────────────────────

const explorePart = (tool: string) => ({
  type: "dynamic-tool",
  toolName: tool,
  state: "output",
});
const webPart = (tool: string) => ({
  type: "dynamic-tool",
  toolName: tool,
  state: "output",
});
const writePart = () => ({
  type: "dynamic-tool",
  toolName: "propose_article_revision",
  state: "output",
});
const evidencePart = () => ({ type: "data-source-evidence", data: {} });
const textPart = () => ({ type: "text", text: "hi" });

describe("aggregateParts", () => {
  it("空输入返回空数组", () => {
    expect(aggregateParts([])).toEqual([]);
  });

  it("单个探索工具不分组，回退为 single", () => {
    const items = aggregateParts([explorePart("project_search")]);
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe("single");
  });

  it("连续 2+ 个探索工具合并为 tool-group", () => {
    const items = aggregateParts([
      explorePart("project_search"),
      explorePart("project_read"),
      explorePart("explore_project"),
    ]);
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe("tool-group");
    if (items[0].kind === "tool-group") {
      expect(items[0].groupType).toBe("explore");
      expect(items[0].parts.length).toBe(3);
      expect(items[0].key).toBe("group-0-2");
    }
  });

  it("跨类型（explore → web）时 flush 前一组", () => {
    const items = aggregateParts([
      explorePart("project_search"),
      explorePart("project_read"),
      webPart("web_search"),
      webPart("web_extract"),
    ]);
    expect(items.length).toBe(2);
    expect(items[0].kind).toBe("tool-group");
    expect(items[1].kind).toBe("tool-group");
    if (items[0].kind === "tool-group" && items[1].kind === "tool-group") {
      expect(items[0].groupType).toBe("explore");
      expect(items[0].parts.length).toBe(2);
      expect(items[1].groupType).toBe("web");
      expect(items[1].parts.length).toBe(2);
    }
  });

  it("写入类工具不进入分组，作为 single 独立渲染", () => {
    const items = aggregateParts([
      explorePart("project_search"),
      explorePart("project_read"),
      writePart(),
      explorePart("project_read"),
      explorePart("project_read"),
    ]);
    expect(items.length).toBe(3);
    expect(items[0].kind).toBe("tool-group");
    expect(items[1].kind).toBe("single");
    expect(items[2].kind).toBe("tool-group");
  });

  it("evidence data part 归入探索组，不打断分组", () => {
    const items = aggregateParts([
      explorePart("project_search"),
      explorePart("project_read"),
      evidencePart(),
      explorePart("explore_project"),
      explorePart("project_read"),
    ]);
    // evidence (data-source-evidence) 属于探索组，5 个 part 全部合并为 1 组
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe("tool-group");
    if (items[0].kind === "tool-group") {
      expect(items[0].parts.length).toBe(5);
    }
  });

  it("text part 穿插打断分组，落入 single 分支", () => {
    const items = aggregateParts([
      explorePart("project_search"),
      explorePart("project_read"),
      textPart(),
      explorePart("explore_project"),
      explorePart("project_read"),
    ]);
    // text 不属于任何分组：前 2 个成组，text 单独，后 2 个成组
    expect(items.length).toBe(3);
    expect(items[0].kind).toBe("tool-group");
    expect(items[1].kind).toBe("single");
    expect(items[2].kind).toBe("tool-group");
  });

  it("text part 在探索工具之前不触发分组", () => {
    const items = aggregateParts([
      textPart(),
      explorePart("project_search"),
      explorePart("project_read"),
    ]);
    expect(items.length).toBe(2);
    expect(items[0].kind).toBe("single");
    expect(items[1].kind).toBe("tool-group");
  });

  it("代码源授权/就绪 part 不参与工具分组，保留独立交互卡片", () => {
    const approvalPart = {
      type: "data-code-source-approval",
      data: { id: "g1", displayName: "InkPress", locator: "/tmp/x" },
    };
    const detectedPart = {
      type: "data-code-source-detected",
      data: { displayName: "InkPress", locator: "/tmp/x" },
    };
    const readyPart = {
      type: "data-code-source-ready",
      data: { displayName: "InkPress", locator: "/tmp/x" },
    };
    const items = aggregateParts([
      detectedPart,
      approvalPart,
      explorePart("project_search"),
      explorePart("project_read"),
      readyPart,
    ]);
    // detected / approval / ready 各自为 single；中间 2 个探索工具合并为 1 组
    expect(items.length).toBe(4);
    expect(items[0]).toMatchObject({ kind: "single", part: detectedPart });
    expect(items[1]).toMatchObject({ kind: "single", part: approvalPart });
    expect(items[2]).toMatchObject({ kind: "tool-group", groupType: "explore" });
    expect(items[3]).toMatchObject({ kind: "single", part: readyPart });
  });

  it("组 key 编码首末索引，保证流式 reconciliation 稳定", () => {
    const items = aggregateParts([
      textPart(),
      explorePart("project_search"),
      explorePart("project_read"),
      explorePart("explore_project"),
    ]);
    const group = items[1];
    expect(group?.kind).toBe("tool-group");
    if (group?.kind === "tool-group") {
      // 首索引=1（text 占了 0），末索引=3
      expect(group.key).toBe("group-1-3");
    }
  });
});
