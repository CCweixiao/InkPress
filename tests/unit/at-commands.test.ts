import { describe, expect, it } from "vitest";
import { atQuery, filterSnippets, type SnippetSearchItem } from "../../src/components/editor/at-commands";

const item = (over: Partial<SnippetSearchItem> = {}): SnippetSearchItem => ({
  id: "x",
  title: "标题",
  summary: "摘要",
  kind: "text",
  tags: [],
  imageUrl: null,
  color: null,
  updatedAt: "2026-07-07T00:00:00.000Z",
  ...over,
});

describe("atQuery", () => {
  it("行首 @ 返回 query 空串", () => {
    expect(atQuery("@", 1, false)).toEqual({ triggerStart: 0, triggerEnd: 1, query: "" });
  });

  it("文中 …融入@产 caret 在末尾 → query=产，triggerStart 指向 @", () => {
    const input = "帮我写文章，融入@产";
    expect(atQuery(input, input.length, false)).toEqual({
      triggerStart: 8,
      triggerEnd: input.length,
      query: "产",
    });
  });

  it("@ 后跟空白 → null", () => {
    expect(atQuery("@ x", 3, false)).toBeNull();
  });

  it("@ 后跟换行 → null", () => {
    expect(atQuery("@\nx", 3, false)).toBeNull();
  });

  it("caret 不在 @ 之后（@产 品，caret 在空格后）→ null", () => {
    expect(atQuery("@产 品", 5, false)).toBeNull();
  });

  it("无 @ → null", () => {
    expect(atQuery("普通文字", 4, false)).toBeNull();
  });

  it("多个 @ 取最近的（foo@bar @baz）", () => {
    const input = "foo@bar @baz";
    expect(atQuery(input, input.length, false)?.query).toBe("baz");
  });

  it("composition 中 → null（无论形态）", () => {
    expect(atQuery("@产", 2, true)).toBeNull();
  });
});

describe("filterSnippets", () => {
  const items = [
    item({ id: "1", title: "产品设计 Product", summary: "减法", tags: ["阅读摘录"] }),
    item({ id: "2", title: "技术灵感", summary: "缓存策略", tags: ["后端"] }),
    item({ id: "3", title: "用户增长", summary: "价值传递", tags: ["增长想法"] }),
  ];

  it("空 query 返回全部", () => {
    expect(filterSnippets(items, "")).toHaveLength(3);
  });

  it("子串匹配 title（大小写不敏感）", () => {
    expect(filterSnippets(items, "产品")).toHaveLength(1);
    expect(filterSnippets(items, "PRODUCT")).toHaveLength(1);
  });

  it("子串匹配 summary", () => {
    expect(filterSnippets(items, "缓存")).toHaveLength(1);
  });

  it("子串匹配 tags", () => {
    expect(filterSnippets(items, "后端")).toHaveLength(1);
  });

  it("无匹配返回空数组", () => {
    expect(filterSnippets(items, "不存在的内容xyz")).toEqual([]);
  });
});
