import { describe, expect, it } from "vitest";
import { buildInkPressToolCallResult } from "../../src/lib/ai/inkpress-mcp-server";
import { INKPRESS_TOOLS } from "../../src/lib/ai/tools/registry";

function toolByName(name: string) {
  const def = INKPRESS_TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`missing tool: ${name}`);
  return def;
}

describe("InkPress MCP tool result formatting", () => {
  it("web_fetch returns text-only model content with explicit success marker", () => {
    const result = buildInkPressToolCallResult(toolByName("web_fetch"), {
      url: "https://example.com/a",
      title: "Example",
      text: "网页正文内容",
    });

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain("WEB_FETCH_STATUS: SUCCESS");
    expect(result.content[0]?.text).toContain("URL: https://example.com/a");
    expect(result.content[0]?.text).toContain("网页正文内容");
    expect("structuredContent" in result).toBe(false);
  });

  it("regular object results keep structuredContent for SDK consumers", () => {
    const result = buildInkPressToolCallResult(toolByName("article_assets"), {
      assets: [{ id: "img1", url: "https://example.com/img.png" }],
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      assets: [{ id: "img1", url: "https://example.com/img.png" }],
    });
  });

  it("array results stay in text content because MCP structuredContent must be a record", () => {
    const snippets = [{ id: "snippet-1", content: "灵感正文" }];
    const result = buildInkPressToolCallResult(
      toolByName("load_snippets"),
      snippets
    );

    expect(result.content[0]?.text).toBe(JSON.stringify(snippets));
    expect("structuredContent" in result).toBe(false);
  });
});
