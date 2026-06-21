import { describe, expect, it } from "vitest";
import { parseAgentConfig } from "../../src/lib/ai/agent-config";

describe("parseAgentConfig", () => {
  it("normalizes valid configuration", () => {
    expect(
      parseAgentConfig(
        JSON.stringify({
          tavilyApiKey: "tvly-test",
          maxSteps: 99,
          contextBudgetTokens: 999999,
          projects: [
            { id: "demo", name: "Demo", root: "/tmp/demo" },
          ],
        })
      )
    ).toEqual({
      tavilyApiKey: "tvly-test",
      maxSteps: 20,
      contextBudgetTokens: 200000,
      projects: [{ id: "demo", name: "Demo", root: "/tmp/demo" }],
    });
  });

  it("rejects duplicate project ids", () => {
    expect(() =>
      parseAgentConfig(
        JSON.stringify({
          projects: [
            { id: "same", name: "A", root: "/tmp/a" },
            { id: "same", name: "B", root: "/tmp/b" },
          ],
        })
      )
    ).toThrow(/重复/);
  });
});
