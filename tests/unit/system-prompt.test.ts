import { describe, expect, it } from "vitest";
import { buildInkPressSystemPrompt } from "../../src/lib/ai/system-prompt";

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
});
