import { describe, expect, it } from "vitest";
import { estimateTokens } from "../../src/lib/ai/context-manager";

describe("estimateTokens", () => {
  it("counts Chinese text more densely than ASCII text", () => {
    expect(estimateTokens("这是一段中文内容")).toBeGreaterThan(
      estimateTokens("short")
    );
  });
});
