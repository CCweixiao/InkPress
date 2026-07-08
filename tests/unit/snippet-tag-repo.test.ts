import { describe, expect, it } from "vitest";
import {
  serializeSnippet,
  normalizeTagNames,
  tagWhere,
  tagSearchWhere,
} from "@/lib/snippets/tag-repo";

describe("normalizeTagNames", () => {
  it("trim + 去空 + 去重保序", () => {
    expect(normalizeTagNames([" a ", "", "a", "b", " b "])).toEqual(["a", "b"]);
  });
  it("空数组", () => {
    expect(normalizeTagNames([])).toEqual([]);
  });
  it("全是空白/空串 → []", () => {
    expect(normalizeTagNames([" ", "", "  "])).toEqual([]);
  });
});

describe("serializeSnippet", () => {
  it("tagAssignments → tags（排序）", () => {
    const out = serializeSnippet({
      id: "1",
      tagAssignments: [{ tag: { name: "b" } }, { tag: { name: "a" } }],
    }) as { id: string; tags: string[] };
    expect(out.id).toBe("1");
    expect(out.tags).toEqual(["a", "b"]);
  });
  it("无 tag → tags: []", () => {
    const out = serializeSnippet({ id: "1", tagAssignments: [] }) as { tags: string[] };
    expect(out.tags).toEqual([]);
  });
  it("剥掉 tagAssignments", () => {
    const out = serializeSnippet({ id: "1", tagAssignments: [] }) as Record<
      string,
      unknown
    >;
    expect(out.tagAssignments).toBeUndefined();
  });
  it("保留其它字段", () => {
    const out = serializeSnippet({
      id: "1",
      title: "t",
      tagAssignments: [{ tag: { name: "x" } }],
    }) as { title: string; tags: string[] };
    expect(out.title).toBe("t");
    expect(out.tags).toEqual(["x"]);
  });
});

describe("tagWhere / tagSearchWhere", () => {
  it("tagWhere 精确", () => {
    expect(tagWhere("foo")).toEqual({
      tagAssignments: { some: { tag: { name: "foo" } } },
    });
  });
  it("tagSearchWhere contains", () => {
    expect(tagSearchWhere("foo")).toEqual({
      tagAssignments: { some: { tag: { name: { contains: "foo" } } } },
    });
  });
});
