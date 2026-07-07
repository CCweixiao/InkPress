import { describe, expect, it } from "vitest";
import { partToAgentRuntimeEvent } from "../../src/lib/ai/agent-runtime-events";

describe("partToAgentRuntimeEvent", () => {
  it("text → text(output)，回读 seq/turnId/source", () => {
    const e = partToAgentRuntimeEvent({
      type: "text",
      text: "hi",
      data: { seq: 1, turnId: "t1", source: "claude-agent-sdk" },
    });
    expect(e?.kind).toBe("text");
    expect(e?.stage).toBe("output");
    expect(e?.seq).toBe(1);
    expect(e?.turnId).toBe("t1");
    expect(e?.source).toBe("claude-agent-sdk");
  });

  it("reasoning → reasoning", () => {
    expect(partToAgentRuntimeEvent({ type: "reasoning", text: "想" })?.kind).toBe(
      "reasoning"
    );
  });

  it("dynamic-tool → tool（读 toolMetadata.seq/display）", () => {
    const e = partToAgentRuntimeEvent({
      type: "dynamic-tool",
      toolName: "project_read",
      toolCallId: "c1",
      state: "output",
      toolMetadata: {
        seq: 5,
        turnId: "t",
        source: "tool",
        display: { title: "读取项目文件", activityKind: "read" },
      },
    });
    expect(e?.kind).toBe("tool");
    expect(e?.seq).toBe(5);
    expect((e as { display?: { title?: string } }).display?.title).toBe(
      "读取项目文件"
    );
  });

  it("tool-output-error → tool(failed)", () => {
    const e = partToAgentRuntimeEvent({
      type: "tool-output-error",
      toolName: "x",
      toolCallId: "c",
      errorText: "boom",
    });
    expect(e?.kind).toBe("tool");
    expect((e as { phase?: string }).phase).toBe("failed");
  });

  it("data-tool-approval → approval(tool)", () => {
    const e = partToAgentRuntimeEvent({
      type: "data-tool-approval",
      data: { seq: 2, grantId: "g1", toolName: "set_article_digest" },
    });
    expect(e?.kind).toBe("approval");
    expect((e as { approvalType?: string }).approvalType).toBe("tool");
    expect(e?.seq).toBe(2);
  });

  it("data-code-source-approval → approval(code_source)", () => {
    const e = partToAgentRuntimeEvent({
      type: "data-code-source-approval",
      data: { id: "g1", displayName: "X" },
    });
    expect(e?.kind).toBe("approval");
    expect((e as { approvalType?: string }).approvalType).toBe("code_source");
  });

  it("data-context-usage → context", () => {
    expect(
      partToAgentRuntimeEvent({
        type: "data-context-usage",
        data: { estimatedTokens: 1000, budgetTokens: 32000 },
      })?.kind
    ).toBe("context");
  });

  it("data-source-evidence / data-commit-evidence / data-git-range → evidence", () => {
    expect(
      partToAgentRuntimeEvent({ type: "data-source-evidence", data: { path: "a.ts", startLine: 1 } })
        ?.kind
    ).toBe("evidence");
    const commit = partToAgentRuntimeEvent({
      type: "data-commit-evidence",
      data: { sha: "abc1234", subject: "fix" },
    });
    expect(commit?.kind).toBe("evidence");
    expect((commit as { evidenceType?: string }).evidenceType).toBe("git_commit");
    expect(
      partToAgentRuntimeEvent({ type: "data-git-range", data: { requestedRange: "本周" } })
        ?.kind
    ).toBe("evidence");
  });

  it("data-agent-step → step（stage 由 data.kind 推导）", () => {
    const e = partToAgentRuntimeEvent({
      type: "data-agent-step",
      data: { kind: "intent", title: "已启动", status: "completed" },
    });
    expect(e?.kind).toBe("step");
    expect(e?.stage).toBe("intent");
    expect((e as { status?: string }).status).toBe("completed");
  });

  it("data-agent-retry → error(retryable)", () => {
    const e = partToAgentRuntimeEvent({
      type: "data-agent-retry",
      data: { level: "turn", attempt: 1, maxRetries: 10 },
    });
    expect(e?.kind).toBe("error");
    expect((e as { retryable?: boolean }).retryable).toBe(true);
  });

  it("未知 part → null", () => {
    expect(partToAgentRuntimeEvent({ type: "something-new" })).toBeNull();
    expect(partToAgentRuntimeEvent({ foo: "bar" })).toBeNull();
  });
});
