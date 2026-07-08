import { describe, it, expect } from "vitest";
import { snippetMatchesAllTags } from "@/lib/snippets/tag-filter";

describe("snippetMatchesAllTags", () => {
  it("空 activeTags 全通过", () => {
    expect(snippetMatchesAllTags(["a"], [])).toBe(true);
    expect(snippetMatchesAllTags([], [])).toBe(true);
  });
  it("单标签命中/不命中", () => {
    expect(snippetMatchesAllTags(["a", "b"], ["a"])).toBe(true);
    expect(snippetMatchesAllTags(["a"], ["b"])).toBe(false);
  });
  it("多标签全命中 true，缺一 false（AND）", () => {
    expect(snippetMatchesAllTags(["a", "b", "c"], ["a", "b"])).toBe(true);
    expect(snippetMatchesAllTags(["a", "b"], ["a", "b", "c"])).toBe(false);
  });
  it("大小写敏感", () => {
    expect(snippetMatchesAllTags(["A"], ["a"])).toBe(false);
  });
});
