import { describe, expect, it } from "vitest";
import { isSafeMarkdownUrl } from "@/lib/markdown/safe-url";

describe("isSafeMarkdownUrl", () => {
  it("allows http, https and root-relative asset urls", () => {
    expect(isSafeMarkdownUrl("https://example.com/image.png")).toBe(true);
    expect(isSafeMarkdownUrl("http://example.com/image.png")).toBe(true);
    expect(isSafeMarkdownUrl("/api/storage/cmrc2iams000644xwafanljl7")).toBe(true);
  });

  it("rejects unsafe protocols and protocol-relative urls", () => {
    expect(isSafeMarkdownUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeMarkdownUrl("data:image/svg+xml,<svg></svg>")).toBe(false);
    expect(isSafeMarkdownUrl("//evil.example/image.png")).toBe(false);
  });
});
