import { describe, expect, it } from "vitest";
import {
  buildInkPressSystemPrompt,
  SNIPPET_FUSION_HINT,
} from "../../src/lib/ai/system-prompt";

describe("buildInkPressSystemPrompt", () => {
  it("requires web_fetch for authoritative research URLs and forbids fake fetch failures", () => {
    const prompt = buildInkPressSystemPrompt({
      target: {
        kind: "article",
        title: "Claude Agent SDK",
        markdown: "",
      },
      skillCatalog: [],
      tavilyApiKey: "tvly-test",
    });

    expect(prompt).toContain("web_search 只用于发现候选来源和摘要线索");
    expect(prompt).toContain("必须继续调用 web_fetch 读取正文");
    expect(prompt).toContain("没有调用 web_fetch、或没有收到错误结果时，不得声称网页抓取失败");
  });

  it("instructs agents to range-read oversized article context before full replacement proposals", () => {
    const prompt = buildInkPressSystemPrompt({
      target: {
        kind: "article",
        title: "长文",
        markdown: "a".repeat(12_200),
      },
      skillCatalog: [],
    });

    expect(prompt).toContain("mcp__inkpress__read_current_article");
    expect(prompt).toContain("正文过长");
    expect(prompt).toContain("覆盖全文");
    expect(prompt).toContain("才能调用 mcp__inkpress__propose_article_revision");
  });
});

describe("snippetsHint section", () => {
  const baseInput = {
    target: { kind: "article" as const, title: "T", markdown: "" },
    skillCatalog: [],
  };

  it("snippetsHint 有值 → 输出含该文本与融入规则", () => {
    const prompt = buildInkPressSystemPrompt({
      ...baseInput,
      snippetsHint: SNIPPET_FUSION_HINT,
    });
    expect(prompt).toContain("灵感素材");
    expect(prompt).toContain("{{snippet:");
    expect(prompt).toContain("保持素材核心观点");
  });

  it("snippetsHint 缺省 → 不含灵感素材段落，且不影响 web/code 段落", () => {
    const prompt = buildInkPressSystemPrompt({
      ...baseInput,
      tavilyApiKey: "tvly-test",
    });
    expect(prompt).not.toContain("灵感素材");
    expect(prompt).toContain("web_fetch"); // 其他段落仍在
  });
});
