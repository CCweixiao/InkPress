import { describe, expect, it } from "vitest";
import { articleVersionHash } from "../../src/lib/ai/article-version";

describe("articleVersionHash", () => {
  it("is stable and changes with any editor field", () => {
    const base = articleVersionHash({
      title: "标题",
      markdown: "正文",
      digest: "摘要",
    });
    expect(
      articleVersionHash({ title: "标题", markdown: "正文", digest: "摘要" })
    ).toBe(base);
    expect(
      articleVersionHash({ title: "新标题", markdown: "正文", digest: "摘要" })
    ).not.toBe(base);
    expect(
      articleVersionHash({ title: "标题", markdown: "新正文", digest: "摘要" })
    ).not.toBe(base);
  });
});
