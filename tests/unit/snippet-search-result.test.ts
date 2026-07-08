import { describe, it, expect } from "vitest";
import { snippetToSearchResultItem } from "@/lib/snippets/search-result";

const base = {
  id: "x1",
  title: "标题",
  content: "第一行内容\n第二行",
  kind: "text",
  tagsJson: "[]",
};

describe("snippetToSearchResultItem", () => {
  it("text：title 取 title，subtitle 含「文字 · 」+ 首行", () => {
    const r = snippetToSearchResultItem(base);
    expect(r.id).toBe("x1");
    expect(r.title).toBe("标题");
    expect(r.subtitle).toContain("文字");
    expect(r.subtitle).toContain("第一行内容");
    expect(r.href).toBe("/snippets");
  });
  it("quote：subtitle 含「引用」", () => {
    const r = snippetToSearchResultItem({ ...base, kind: "quote" });
    expect(r.subtitle).toContain("引用");
  });
  it("link：subtitle 含「链接」", () => {
    const r = snippetToSearchResultItem({ ...base, kind: "link" });
    expect(r.subtitle).toContain("链接");
  });
  it("image：subtitle 含「图文」", () => {
    const r = snippetToSearchResultItem({ ...base, kind: "image" });
    expect(r.subtitle).toContain("图文");
  });
  it("title 空时用 content 首行兜底；title+content 都空 → 无标题灵感", () => {
    expect(snippetToSearchResultItem({ ...base, title: "" }).title).toBe(
      "第一行内容"
    );
    expect(
      snippetToSearchResultItem({ ...base, title: "", content: "" }).title
    ).toBe("无标题灵感");
  });
  it("多行 content → subtitle 只取首行 ≤60", () => {
    const r = snippetToSearchResultItem({ ...base, content: "首行\n次行" });
    expect(r.subtitle).toContain("首行");
    expect(r.subtitle).not.toContain("次行");
  });
  it("未知 kind → subtitle 含「灵感」", () => {
    const r = snippetToSearchResultItem({ ...base, kind: "weird" });
    expect(r.subtitle).toContain("灵感");
  });
  it("href 恒 /snippets", () => {
    expect(snippetToSearchResultItem(base).href).toBe("/snippets");
  });
});
