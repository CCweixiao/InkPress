import { describe, expect, it } from "vitest";
import {
  extractMarkdownImages,
  getFirstMarkdownImage,
  stripMarkdownImages,
} from "@/lib/markdown/images";

describe("markdown image helpers", () => {
  it("extracts multiple uploaded images in order", () => {
    expect(
      extractMarkdownImages(
        "![a](/api/storage/a)![b](/api/storage/b)\n\n正文"
      )
    ).toEqual([
      { alt: "a", src: "/api/storage/a" },
      { alt: "b", src: "/api/storage/b" },
    ]);
  });

  it("strips image syntax while keeping text content", () => {
    expect(stripMarkdownImages("![a](/api/storage/a)\n\n嘿嘿 #学习")).toBe(
      "嘿嘿 #学习"
    );
  });

  it("selects only the first image for card preview", () => {
    expect(getFirstMarkdownImage("![a](/api/storage/a)![b](/api/storage/b)")).toEqual({
      alt: "a",
      src: "/api/storage/a",
    });
  });
});
