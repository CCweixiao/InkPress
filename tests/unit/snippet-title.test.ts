import { describe, expect, it } from "vitest";
import {
  deriveSnippetTitle,
  resolveSnippetUpdateTitle,
} from "../../src/lib/snippets/title";

describe("snippet title", () => {
  it("derives a trimmed, truncated title from the first content line", () => {
    expect(deriveSnippetTitle(`  新的灵感标题  \n后续正文`)).toBe("新的灵感标题");
    expect(deriveSnippetTitle("一".repeat(60))).toBe("一".repeat(50));
    expect(deriveSnippetTitle("   \n")).toBe("无标题");
  });

  it("refreshes a derived title when content changes", () => {
    expect(
      resolveSnippetUpdateTitle({
        currentTitle: "旧标题",
        content: "新标题\n新的正文",
      })
    ).toBe("新标题");
  });

  it("keeps an explicitly submitted title", () => {
    expect(
      resolveSnippetUpdateTitle({
        currentTitle: "旧标题",
        content: "正文首行",
        title: "自定义标题",
      })
    ).toBe("自定义标题");
  });

  it("does not change title when content is absent", () => {
    expect(resolveSnippetUpdateTitle({ currentTitle: "旧标题" })).toBeUndefined();
  });
});
