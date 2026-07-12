import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createSdkToUiAdapter } from "../../src/lib/ai/agent-sdk-stream-adapter";
import { selectInkPressTools } from "../../src/lib/ai/tools/registry";

const sdkResultFixtures: SDKMessage[] = [
  {
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "sdk-0195",
    stop_reason: "end_turn",
    duration_ms: 100,
    duration_api_ms: 80,
    num_turns: 1,
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    result: "done",
  } as unknown as SDKMessage,
  {
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "sdk-0205",
    terminal_reason: "stop",
    duration_ms: 90,
    duration_api_ms: 70,
    num_turns: 1,
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    result: "done",
  } as unknown as SDKMessage,
];

describe("agent capability selection", () => {
  it("does not expose code or web tools to an article-only turn", () => {
    const names = selectInkPressTools({
      targetKind: "article",
      hasCodeSource: false,
      webResearchEnabled: false,
    }).map((tool) => tool.name);

    expect(names).toContain("propose_article_revision");
    expect(names).not.toContain("project_read");
    expect(names).not.toContain("git_log");
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("web_fetch");
  });

  it("enables code and web tools for a capable article turn", () => {
    const names = selectInkPressTools({
      targetKind: "article",
      hasCodeSource: true,
      webResearchEnabled: true,
    }).map((tool) => tool.name);

    expect(names).toContain("propose_article_revision");
    expect(names).toContain("set_article_digest");
    expect(names).toContain("project_read");
    expect(names).toContain("web_search");
  });
});

describe("agent SDK result compatibility", () => {
  it.each(sdkResultFixtures)(
    "normalizes terminal metadata for old and new result shapes",
    (fixture) => {
      const adapter = createSdkToUiAdapter({ write: () => undefined });
      adapter.consume(fixture);
      expect(adapter.result.runtimeMetadata?.terminalReason).toBeTruthy();
    }
  );

  it("counts unknown SDK messages for diagnostics", () => {
    const adapter = createSdkToUiAdapter({ write: () => undefined });
    adapter.consume({ type: "future_sdk_event" } as unknown as SDKMessage);
    expect(adapter.result.unknownEventCount).toBe(1);
  });
});

describe("agent options performance and SDK version contract", () => {
  it("loads independent option dependencies in parallel", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/lib/ai/claude-agent-options.ts"),
      "utf8"
    );
    expect(source).toMatch(/Promise\.all\(/);
  });

  it("pins the reviewed Claude Agent SDK contract version", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")
    ) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@anthropic-ai/claude-agent-sdk"]).toBe("0.3.207");
  });
});
