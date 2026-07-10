import { describe, it, expect } from "vitest";
import { PRESET_TAG_COLORS, normalizeColor } from "@/lib/tasks/tag-colors";

describe("tag-colors", () => {
  it("PRESET_TAG_COLORS 首项为默认灰 #6b7280", () => {
    expect(PRESET_TAG_COLORS[0]).toBe("#6b7280");
  });

  it("PRESET_TAG_COLORS 至少 8 色", () => {
    expect(PRESET_TAG_COLORS.length).toBeGreaterThanOrEqual(8);
  });

  it("normalizeColor：合法 hex 透传", () => {
    expect(normalizeColor("#3b82f6")).toBe("#3b82f6");
  });

  it("normalizeColor：大写 hex 透传", () => {
    expect(normalizeColor("#ABCDEF")).toBe("#ABCDEF");
  });

  it("normalizeColor：非法值回退默认灰", () => {
    expect(normalizeColor("not-a-color")).toBe("#6b7280");
  });

  it("normalizeColor：3 位短 hex 回退默认灰（仅接受 6 位）", () => {
    expect(normalizeColor("#fff")).toBe("#6b7280");
  });

  it("normalizeColor：空字符串回退默认灰", () => {
    expect(normalizeColor("")).toBe("#6b7280");
  });
});
