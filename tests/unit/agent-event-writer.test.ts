import { describe, expect, it } from "vitest";
import { createAgentEventWriter } from "../../src/lib/ai/agent-event-writer";
import type { UIStreamWriterLike } from "../../src/lib/ai/agent-sdk-stream-adapter";

/** 收集写入 part 的 mock writer。 */
function collectWriter(): {
  writer: UIStreamWriterLike;
  written: Record<string, unknown>[];
} {
  const written: Record<string, unknown>[] = [];
  return {
    written,
    writer: { write: (p) => written.push(p as Record<string, unknown>) },
  };
}

describe("createAgentEventWriter", () => {
  it("data part 注入单调递增 seq + turnId + source 到 part.data", () => {
    const { writer, written } = collectWriter();
    const ew = createAgentEventWriter(writer, {
      turnId: "T1",
      source: "claude-agent-sdk",
    });
    ew.write({ type: "data-agent-step", id: "a", data: { title: "x" } } as never);
    ew.write({ type: "data-context-usage", id: "b", data: { estimatedTokens: 1 } } as never);

    expect((written[0].data as Record<string, unknown>).seq).toBe(1);
    expect((written[0].data as Record<string, unknown>).turnId).toBe("T1");
    expect((written[0].data as Record<string, unknown>).source).toBe("claude-agent-sdk");
    expect((written[0].data as Record<string, unknown>).title).toBe("x"); // 原字段保留
    expect((written[1].data as Record<string, unknown>).seq).toBe(2);
  });

  it("tool part 注入 seq 到 toolMetadata（不破坏已有 display）", () => {
    const { writer, written } = collectWriter();
    const ew = createAgentEventWriter(writer, {
      turnId: "T1",
      source: "tool",
    });
    // MCP 已写入 display（模拟 inkpress-mcp-server 的产物）
    ew.write({
      type: "tool-input-available",
      toolCallId: "c1",
      toolName: "project_read",
      input: { path: "a.ts" },
      toolMetadata: { display: { title: "读取项目文件", activityKind: "read" } },
      dynamic: true,
    } as never);
    ew.write({
      type: "tool-output-available",
      toolCallId: "c1",
      toolName: "project_read",
      output: { path: "a.ts" },
      toolMetadata: { display: { title: "读取项目文件", activityKind: "read", summary: "已读取 a.ts" } },
      dynamic: true,
    } as never);

    const tm0 = written[0].toolMetadata as Record<string, unknown>;
    const tm1 = written[1].toolMetadata as Record<string, unknown>;
    expect(tm0.seq).toBe(1);
    expect(tm1.seq).toBe(2);
    expect(tm0.turnId).toBe("T1");
    expect(tm0.source).toBe("tool");
    // display 必须保留（spread merge，未被覆盖）
    expect((tm0.display as Record<string, unknown>).title).toBe("读取项目文件");
    expect((tm1.display as Record<string, unknown>).summary).toBe("已读取 a.ts");
  });

  it("data 与 tool part 共享同一 seq 计数器（单调无断号）", () => {
    const { writer, written } = collectWriter();
    const ew = createAgentEventWriter(writer, { turnId: "T", source: "claude-agent-sdk" });
    ew.write({ type: "data-agent-step", id: "1", data: {} } as never);
    ew.write({ type: "tool-input-available", toolCallId: "c", toolName: "x", toolMetadata: {} } as never);
    ew.write({ type: "data-context-usage", id: "2", data: {} } as never);

    expect((written[0].data as Record<string, unknown>).seq).toBe(1);
    expect((written[1].toolMetadata as Record<string, unknown>).seq).toBe(2);
    expect((written[2].data as Record<string, unknown>).seq).toBe(3);
  });

  it("text-delta / reasoning-delta 直通：不注入、不计数", () => {
    const { writer, written } = collectWriter();
    const ew = createAgentEventWriter(writer, { turnId: "T", source: "claude-agent-sdk" });
    ew.write({ type: "text-start", id: "t" } as never);
    ew.write({ type: "text-delta", id: "t", delta: "hi" } as never);
    ew.write({ type: "reasoning-delta", id: "r", delta: "思考" } as never);
    ew.write({ type: "text-end", id: "t" } as never);

    // 无任何 seq 字段；后续 data part 仍从 1 开始（text/reasoning 未占用计数器）
    for (const p of written) {
      const data = p.data as Record<string, unknown> | undefined;
      expect(data?.seq).toBeUndefined();
    }
    ew.write({ type: "data-agent-step", id: "s", data: {} } as never);
    expect((written[4].data as Record<string, unknown>).seq).toBe(1);
  });

  it("data 为 undefined 的 data part 不崩，注入后 data 含 seq", () => {
    const { writer, written } = collectWriter();
    const ew = createAgentEventWriter(writer, { turnId: "T", source: "claude-agent-sdk" });
    ew.write({ type: "data-agent-step", id: "x" } as never); // 无 data 字段
    expect((written[0].data as Record<string, unknown>).seq).toBe(1);
    expect((written[0].data as Record<string, unknown>).turnId).toBe("T");
  });

  it("tool-output-error 注入 toolMetadata.seq（失败态）", () => {
    const { writer, written } = collectWriter();
    const ew = createAgentEventWriter(writer, { turnId: "T", source: "claude-agent-sdk" });
    ew.write({
      type: "tool-output-error",
      toolCallId: "c",
      toolName: "x",
      errorText: "boom",
      toolMetadata: { display: { title: "x", activityKind: "general" } },
    } as never);
    const tm = written[0].toolMetadata as Record<string, unknown>;
    expect(tm.seq).toBe(1);
    expect((tm.display as Record<string, unknown>).title).toBe("x");
  });
});
