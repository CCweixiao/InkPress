import { describe, expect, it } from "vitest";
import { composeDraftBody, deriveDraftTitle } from "@/lib/snippets/draft-export";

describe("composeDraftBody", () => {
  it("多条 text 用 --- 分隔", () => {
    const out = composeDraftBody([
      { kind: "text", content: "甲" },
      { kind: "text", content: "乙" },
    ]);
    expect(out).toBe("甲\n\n---\n\n乙");
  });
  it("单条不加分隔", () => {
    expect(composeDraftBody([{ kind: "text", content: "只有一条" }])).toBe("只有一条");
  });
  it("混合 kind 各自映射 md，--- 分隔", () => {
    const out = composeDraftBody([
      { kind: "text", content: "想法" },
      { kind: "quote", content: "金句", quoteSource: "作者" },
    ]);
    expect(out).toBe('想法\n\n---\n\n> "金句"\n>\n> —— 作者');
  });
  it("空数组返空串", () => {
    expect(composeDraftBody([])).toBe("");
  });
  it("link 映射为 [text](url)", () => {
    const out = composeDraftBody([
      { kind: "link", content: "看看", linkUrl: "https://x.com", linkTitle: "标题" },
    ]);
    expect(out).toBe("[标题](https://x.com) — 看看");
  });
});

describe("deriveDraftTitle", () => {
  it("有 title 用 title", () => {
    expect(deriveDraftTitle([{ kind: "text", content: "正文", title: "标题" }])).toBe("标题");
  });
  it("无 title 回落 content 首行", () => {
    expect(deriveDraftTitle([{ kind: "text", content: "第一行\n第二行" }])).toBe("第一行");
  });
  it("title 超长截断 30 字", () => {
    expect(deriveDraftTitle([{ kind: "text", content: "x", title: "一".repeat(50) }]).length).toBe(30);
  });
  it("content 超长截断 30 字", () => {
    expect(deriveDraftTitle([{ kind: "text", content: "一".repeat(50) }]).length).toBe(30);
  });
  it("空数组 fallback「素材草稿」", () => {
    expect(deriveDraftTitle([])).toBe("素材草稿");
  });
  it("首条全空 fallback「素材草稿」", () => {
    expect(deriveDraftTitle([{ kind: "text", content: "  " }])).toBe("素材草稿");
  });
});
