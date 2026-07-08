import { describe, it, expect } from "vitest";
import {
  snippetMatchesAllTags,
  collectUniqueTags,
} from "@/lib/snippets/tag-filter";

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

describe("collectUniqueTags", () => {
  it("空数组 → []", () => {
    expect(collectUniqueTags([])).toEqual([]);
  });
  it("单 snippet 多标签各计数 1", () => {
    const r = collectUniqueTags([{ tagsJson: '["a","b"]' }]);
    expect(r).toContainEqual({ name: "a", count: 1 });
    expect(r).toContainEqual({ name: "b", count: 1 });
  });
  it("多 snippet 共享标签计数累加 + count 降序", () => {
    const r = collectUniqueTags([
      { tagsJson: '["a","b"]' },
      { tagsJson: '["a","c"]' },
      { tagsJson: '["a"]' },
    ]);
    expect(r).toEqual([
      { name: "a", count: 3 },
      { name: "b", count: 1 },
      { name: "c", count: 1 },
    ]);
  });
  it("count 相同按 name 升序", () => {
    const r = collectUniqueTags([{ tagsJson: '["z","a","m"]' }]);
    expect(r.map((t) => t.name)).toEqual(["a", "m", "z"]);
  });
  it("非法 JSON / 非数组 / 空串 / 非字符串 跳过不崩", () => {
    const r = collectUniqueTags([
      { tagsJson: "not json" },
      { tagsJson: "[1,2]" },
      { tagsJson: '["", "ok", 3]' },
      { tagsJson: "null" },
    ]);
    expect(r).toEqual([{ name: "ok", count: 1 }]);
  });
  it("tagsJson: null 当空数组", () => {
    expect(collectUniqueTags([{ tagsJson: null }])).toEqual([]);
  });
});
