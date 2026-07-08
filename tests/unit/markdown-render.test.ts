import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/ai/Markdown";

describe("Markdown", () => {
  it("renders root-relative uploaded images", () => {
    const html = renderToStaticMarkup(
      createElement(
        Markdown,
        null,
        "![image.png](/api/storage/cmrc2iams000644xwafanljl7)"
      )
    );

    expect(html).toContain('<img src="/api/storage/cmrc2iams000644xwafanljl7"');
  });
});
