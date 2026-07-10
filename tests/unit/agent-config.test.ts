import { describe, expect, it } from "vitest";
import { parseAgentConfig } from "../../src/lib/ai/agent-config";

describe("parseAgentConfig", () => {
  it("normalizes valid configuration", () => {
    expect(
      parseAgentConfig(
        JSON.stringify({
          tavilyApiKey: "tvly-test",
          githubToken: "github-test",
          maxSteps: 99,
          maxBudgetUsd: 999,
          contextBudgetTokens: 999999,
          projects: [
            { id: "demo", name: "Demo", root: "/tmp/demo" },
          ],
        })
      )
    ).toEqual({
      tavilyApiKey: "tvly-test",
      githubToken: "github-test",
      maxSteps: 20,
      maxBudgetUsd: 5,
      contextBudgetTokens: 200000,
      projects: [{ id: "demo", name: "Demo", root: "/tmp/demo" }],
    });
  });

  it("clamps maxSteps and maxBudgetUsd to lower bounds", () => {
    expect(
      parseAgentConfig(JSON.stringify({ maxSteps: 1, maxBudgetUsd: -10 }))
    ).toMatchObject({
      maxSteps: 3,
      maxBudgetUsd: 0.1,
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
