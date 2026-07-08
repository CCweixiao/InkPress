import { describe, it, expect } from "vitest";
import {
  TAG_COLOR_NAMES,
  DEFAULT_TAG_COLOR,
  isValidTagColor,
  getTagColorClasses,
  resolveTagColor,
} from "@/lib/snippets/tag-colors";

describe("isValidTagColor", () => {
  it("8 色全 true", () => {
    for (const c of TAG_COLOR_NAMES) expect(isValidTagColor(c)).toBe(true);
  });
  it("null/undefined/空/非板色 false", () => {
    expect(isValidTagColor(null)).toBe(false);
    expect(isValidTagColor(undefined)).toBe(false);
    expect(isValidTagColor("")).toBe(false);
    expect(isValidTagColor("red")).toBe(false);
  });
});

describe("getTagColorClasses", () => {
  it("amber 返回 amber 类", () => {
    const cls = getTagColorClasses("amber");
    expect(cls.pill).toContain("bg-amber-500/10");
    expect(cls.dot).toContain("bg-amber-500");
  });
  it("null → slate 默认", () => {
    expect(getTagColorClasses(null)).toEqual(
      getTagColorClasses(DEFAULT_TAG_COLOR)
    );
  });
  it("非法值 → slate 兜底", () => {
    expect(getTagColorClasses("red")).toEqual(getTagColorClasses("slate"));
  });
  it("所有 8 色类对象齐全 dot/pill/active/text", () => {
    for (const c of TAG_COLOR_NAMES) {
      const cls = getTagColorClasses(c);
      expect(cls.dot).toBeTruthy();
      expect(cls.pill).toBeTruthy();
      expect(cls.active).toBeTruthy();
      expect(cls.text).toBeTruthy();
    }
  });
});

describe("resolveTagColor", () => {
  it("映射有有效色 → 返回", () => {
    expect(resolveTagColor("a", { a: "blue" })).toBe("blue");
  });
  it("映射值无效 → null", () => {
    expect(resolveTagColor("a", { a: "red" })).toBe(null);
  });
  it("映射无此 tag → null", () => {
    expect(resolveTagColor("a", { b: "blue" })).toBe(null);
  });
});
