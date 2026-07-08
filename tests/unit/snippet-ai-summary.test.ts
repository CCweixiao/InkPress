import { describe, expect, it } from "vitest";
import {
  composePromptInput,
  decideStrategy,
  normalizeAiSummary,
} from "@/lib/snippets/ai-summary";

describe("decideStrategy", () => {
  it("text 走 ai", () => {
    expect(decideStrategy({ kind: "text", content: "今天读到一篇好文章" })).toBe("ai");
  });
  it("quote 走 ai", () => {
    expect(
      decideStrategy({ kind: "quote", content: "保持简单", quoteSource: "某作者" })
    ).toBe("ai");
  });
  it("link 有 linkDescription 走 copy（优先级最高）", () => {
    expect(
      decideStrategy({
        kind: "link",
        content: "https://x.com",
        linkDescription: "一篇深度好文",
      })
    ).toBe("copy");
  });
  it("link 无 linkDescription 走 ai", () => {
    expect(decideStrategy({ kind: "link", content: "https://x.com" })).toBe("ai");
  });
  it("link 的 linkDescription 仅空白 走 ai", () => {
    expect(
      decideStrategy({ kind: "link", content: "https://x.com", linkDescription: "   " })
    ).toBe("ai");
  });
  it("image 一律 skip", () => {
    expect(decideStrategy({ kind: "image", content: "截图说明" })).toBe("skip");
  });
  it("text 过短（<3）走 skip", () => {
    expect(decideStrategy({ kind: "text", content: "ab" })).toBe("skip");
  });
  it("text 仅空白走 skip", () => {
    expect(decideStrategy({ kind: "text", content: "   " })).toBe("skip");
  });
});

describe("composePromptInput", () => {
  it("text 原样（截断 1000 内）", () => {
    expect(composePromptInput({ kind: "text", content: "正文内容" })).toBe("正文内容");
  });
  it("quote 附出处", () => {
    expect(
      composePromptInput({ kind: "quote", content: "保持简单", quoteSource: "某作者" })
    ).toBe("保持简单\n—— 某作者");
  });
  it("quote 无出处不追加", () => {
    expect(composePromptInput({ kind: "quote", content: "保持简单" })).toBe("保持简单");
  });
  it("link 附 linkTitle（优先于 linkUrl）", () => {
    expect(
      composePromptInput({
        kind: "link",
        content: "看这个",
        linkTitle: "标题",
        linkUrl: "https://x.com",
      })
    ).toBe("看这个\n链接：标题");
  });
  it("link 无 title 回落 linkUrl", () => {
    expect(
      composePromptInput({ kind: "link", content: "看这个", linkUrl: "https://x.com" })
    ).toBe("看这个\n链接：https://x.com");
  });
  it("超长内容截断到 1000 字", () => {
    const long = "a".repeat(2000);
    expect(composePromptInput({ kind: "text", content: long }).length).toBe(1000);
  });
});

describe("normalizeAiSummary", () => {
  it("普通文本 trim 后原样", () => {
    expect(normalizeAiSummary("  一句话摘要  ")).toBe("一句话摘要");
  });
  it("去成对中文双引号", () => {
    expect(normalizeAiSummary("“一句话摘要”")).toBe("一句话摘要");
  });
  it("去成对英文双引号", () => {
    expect(normalizeAiSummary('"一句话摘要"')).toBe("一句话摘要");
  });
  it("不成对引号保留", () => {
    expect(normalizeAiSummary('"一句话摘要')).toBe('"一句话摘要');
  });
  it("超长截断到 40 字", () => {
    const out = normalizeAiSummary("一".repeat(50));
    expect(out).not.toBeNull();
    expect(out!.length).toBe(40);
  });
  it("空串返 null", () => {
    expect(normalizeAiSummary("   ")).toBeNull();
  });
  it("空串（去引号后）返 null", () => {
    expect(normalizeAiSummary('""')).toBeNull();
  });
});
