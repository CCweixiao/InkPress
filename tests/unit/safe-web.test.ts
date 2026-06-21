import { describe, expect, it } from "vitest";
import { assertSafePublicUrl } from "../../src/lib/ai/safe-web";

describe("assertSafePublicUrl", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1/private",
    "http://10.0.0.1/private",
    "http://169.254.169.254/latest/meta-data",
    "http://[::ffff:10.0.0.1]/private",
    "file:///etc/passwd",
  ])("blocks unsafe URL %s", async (url) => {
    await expect(assertSafePublicUrl(url)).rejects.toThrow();
  });

  it("accepts a public literal IP", async () => {
    await expect(assertSafePublicUrl("https://1.1.1.1/")).resolves.toBe(
      "https://1.1.1.1/"
    );
  });
});
