import { describe, expect, it } from "vitest";
import {
  PART_RENDERERS,
  STAGE_ORDER,
  type Stage,
} from "../../src/components/editor/WritingAssistant";

/**
 * 验证 part 渲染注册表：
 * 1. 每种 part 恰好命中一个 renderer（无重叠、无遗漏）；
 * 2. 命中 renderer 的 stage 符合 §2.1 阶段模型；
 * 3. 特化 matcher 在通用 tool matcher 之前（工具 part 不会被 data-* 抢走，反之亦然）。
 * 只测 match()/stage 纯逻辑，不渲染 JSX。
 */

type Fixture = { name: string; part: Record<string, unknown>; stage: Stage };

const fixtures: Fixture[] = [
  { name: "text", part: { type: "text", text: "hi" }, stage: "output" },
  { name: "reasoning", part: { type: "reasoning", text: "思考" }, stage: "reasoning" },
  {
    name: "code-source-approval",
    part: { type: "data-code-source-approval", data: { id: "1" } },
    stage: "ready",
  },
  {
    name: "code-source-ready",
    part: { type: "data-code-source-ready", data: { displayName: "x" } },
    stage: "ready",
  },
  { name: "git-range", part: { type: "data-git-range", data: {} }, stage: "evidence" },
  { name: "commit-evidence", part: { type: "data-commit-evidence", data: {} }, stage: "evidence" },
  {
    name: "change-evidence-summary",
    part: { type: "data-change-evidence-summary", data: {} },
    stage: "evidence",
  },
  {
    name: "code-explore-step",
    part: { type: "data-code-explore-step", data: {} },
    stage: "evidence",
  },
  {
    name: "project-snapshot",
    part: { type: "data-project-snapshot", data: {} },
    stage: "evidence",
  },
  {
    name: "source-evidence",
    part: { type: "data-source-evidence", data: {} },
    stage: "evidence",
  },
  { name: "source-url", part: { type: "source-url", url: "https://x" }, stage: "evidence" },
  { name: "agent-step", part: { type: "data-agent-step", data: {} }, stage: "intent" },
  { name: "context-usage", part: { type: "data-context-usage", data: {} }, stage: "meta" },
  {
    name: "dynamic-tool",
    part: { type: "dynamic-tool", toolName: "web_search" },
    stage: "tool",
  },
  { name: "tool-prefix", part: { type: "tool-foo" }, stage: "tool" },
];

describe("agent part 渲染注册表", () => {
  it("STAGE_ORDER 覆盖所有 stage 且无重复", () => {
    expect(new Set(STAGE_ORDER).size).toBe(STAGE_ORDER.length);
    expect(STAGE_ORDER).toContain("tool");
    expect(STAGE_ORDER).toContain("evidence");
  });

  for (const fixture of fixtures) {
    it(`${fixture.name} 恰好命中一个 renderer 且 stage=${fixture.stage}`, () => {
      const matched = PART_RENDERERS.filter((r) => r.match(fixture.part));
      expect(matched.length, `${fixture.name} 应唯一命中`).toBe(1);
      expect(matched[0].stage).toBe(fixture.stage);
    });
  }

  it("data-* part 不会被通用 tool renderer 误命中", () => {
    // data-git-range 没有工具名，tool renderer 的 match 应返回 false
    const toolRenderer = PART_RENDERERS.find((r) => r.stage === "tool");
    expect(toolRenderer?.match({ type: "data-git-range", data: {} })).toBe(false);
  });

  it("无 type 的未知 part 不命中任何 renderer", () => {
    const matched = PART_RENDERERS.filter((r) => r.match({ foo: "bar" }));
    expect(matched.length).toBe(0);
  });
});
