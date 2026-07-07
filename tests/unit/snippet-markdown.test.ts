import { describe, expect, it } from "vitest";
import { snippetToMarkdown } from "../../src/lib/ai/snippet-markdown";

describe("snippetToMarkdown", () => {
  it("text → content 原样", () => {
    expect(snippetToMarkdown({ kind: "text", content: "一段灵感" })).toBe("一段灵感");
  });

  it("quote + source → blockquote 含出处", () => {
    expect(
      snippetToMarkdown({ kind: "quote", content: "减法", quoteSource: "张小龙" })
    ).toBe('> "减法"\n>\n> —— 张小龙');
  });

  it("quote 无 source → 简单 blockquote", () => {
    expect(snippetToMarkdown({ kind: "quote", content: "减法" })).toBe('> "减法"');
  });

  it("image + content → 图片后接配文", () => {
    expect(
      snippetToMarkdown({
        kind: "image",
        content: "配文",
        imageUrl: "http://x/a.png",
        title: "图",
      })
    ).toBe("![图](http://x/a.png)\n配文");
  });

  it("image 无 content → 仅图片行（title 缺省为「图」）", () => {
    expect(
      snippetToMarkdown({ kind: "image", content: "", imageUrl: "http://x/a.png" })
    ).toBe("![图](http://x/a.png)");
  });

  it("link + content → 链接带备注", () => {
    expect(
      snippetToMarkdown({
        kind: "link",
        content: "备注",
        linkUrl: "http://x",
        linkTitle: "标题",
      })
    ).toBe("[标题](http://x) — 备注");
  });

  it("link 无 linkTitle → 用 url 作文本", () => {
    expect(
      snippetToMarkdown({ kind: "link", content: "", linkUrl: "http://x" })
    ).toBe("[http://x](http://x)");
  });

  it("未知 kind → 兜底按 text", () => {
    expect(snippetToMarkdown({ kind: "weird", content: "x" })).toBe("x");
  });
});
