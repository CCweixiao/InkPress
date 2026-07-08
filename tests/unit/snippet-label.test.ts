import { describe, it, expect } from "vitest";
import { pickSnippetLabel } from "@/lib/snippets/snippet-label";

describe("pickSnippetLabel", () => {
  it("title 非空直接返回", () => {
    expect(pickSnippetLabel("我的标题", "任何内容")).toBe("我的标题");
  });
  it("title 仅空白时回退到 content 首个非空行", () => {
    expect(pickSnippetLabel("   ", "\n  \n第二行内容")).toBe("第二行内容");
  });
  it("title 空时取 content 首行", () => {
    expect(pickSnippetLabel("", "首行\n第二行")).toBe("首行");
  });
  it("content 首行超过 40 字截断", () => {
    const long = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十1234567890";
    expect(pickSnippetLabel("", long)).toBe(long.slice(0, 40));
  });
  it("title 与 content 均空 → 占位", () => {
    expect(pickSnippetLabel("", "")).toBe("（无内容）");
    expect(pickSnippetLabel("   ", "\n  \n")).toBe("（无内容）");
  });
});
