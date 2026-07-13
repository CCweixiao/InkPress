import { describe, expect, it } from "vitest";
import { parseAgentConfig } from "../../src/lib/ai/agent-config";

describe("parseAgentConfig", () => {
  it("normalizes valid configuration", () => {
    expect(
      parseAgentConfig(
        JSON.stringify({
          tavilyApiKey: "tvly-test",
          maxSteps: 9999,
          runtimeTimeoutSeconds: 999999,
          apiTimeoutSeconds: 999999,
          apiMaxRetries: 999,
          asyncAgentStallTimeoutSeconds: 999999,
          streamIdleTimeoutSeconds: 1,
          projects: [{ id: "ignored", name: "Ignored", root: "/tmp/ignored" }],
        })
      )
    ).toEqual({
      tavilyApiKey: "tvly-test",
      maxSteps: 1000,
      runtimeTimeoutSeconds: 3600,
      apiTimeoutSeconds: 3600,
      apiMaxRetries: 15,
      asyncAgentStallTimeoutSeconds: 3600,
      streamIdleTimeoutSeconds: 300,
      projects: [],
    });
  });

  it("clamps limits to lower bounds", () => {
    expect(
      parseAgentConfig(
        JSON.stringify({
          maxSteps: 1,
          runtimeTimeoutSeconds: 1,
          apiTimeoutSeconds: 1,
          apiMaxRetries: -1,
          asyncAgentStallTimeoutSeconds: 1,
          streamIdleTimeoutSeconds: 1,
        })
      )
    ).toMatchObject({
      maxSteps: 3,
      runtimeTimeoutSeconds: 30,
      apiTimeoutSeconds: 30,
      apiMaxRetries: 0,
      asyncAgentStallTimeoutSeconds: 30,
      streamIdleTimeoutSeconds: 300,
    });
  });

  it("uses roomy defaults for writing agent limits", () => {
    expect(parseAgentConfig(JSON.stringify({}))).toMatchObject({
      maxSteps: 1000,
      runtimeTimeoutSeconds: 1800,
      apiTimeoutSeconds: 900,
      apiMaxRetries: 12,
      asyncAgentStallTimeoutSeconds: 900,
      streamIdleTimeoutSeconds: 300,
    });
  });

  it("upgrades legacy default max steps without overriding versioned user choices", () => {
    expect(
      parseAgentConfig(
        JSON.stringify({ maxSteps: 12, contextBudgetTokens: 32000 })
      )
    ).toMatchObject({
      maxSteps: 1000,
    });
    expect(
      parseAgentConfig(
        JSON.stringify({
          configVersion: 2,
          maxSteps: 12,
          contextBudgetTokens: 32000,
        })
      )
    ).toMatchObject({
      maxSteps: 1000,
    });
    expect(
      parseAgentConfig(
        JSON.stringify({
          configVersion: 3,
          maxSteps: 12,
        })
      )
    ).toMatchObject({
      maxSteps: 12,
    });
  });

  it("ignores legacy trusted projects", () => {
    expect(
      parseAgentConfig(
        JSON.stringify({
          projects: [{ id: "old", name: "Old", root: "/tmp/old" }],
        })
      )
    ).toMatchObject({ projects: [] });
  });
});
