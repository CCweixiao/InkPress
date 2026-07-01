import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createSdkToUiAdapter } from "../../src/lib/ai/agent-sdk-stream-adapter";

describe("createSdkToUiAdapter task events", () => {
  it("retains subagent type for task notifications that omit subagent_type", () => {
    const parts: Array<Record<string, unknown>> = [];
    const adapter = createSdkToUiAdapter({
      write: (part) => parts.push(part as unknown as Record<string, unknown>),
    });

    adapter.consume({
      type: "system",
      subtype: "task_started",
      task_id: "task-1",
      subagent_type: "research",
      prompt: "collect facts",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage);
    adapter.consume({
      type: "system",
      subtype: "task_notification",
      task_id: "task-1",
      status: "completed",
      output_file: "out.json",
      summary: "done",
      uuid: "u2",
      session_id: "s1",
    } as unknown as SDKMessage);

    const titles = parts
      .filter((p) => p.type === "data-agent-step")
      .map((p) => (p.data as { title?: string }).title);
    expect(titles).toContain("子任务启动（research）");
    expect(titles).toContain("子任务完成（research）");
    const taskParts = parts.filter((p) => p.type === "data-agent-step");
    expect(taskParts).toHaveLength(2);
    expect((taskParts[1].data as { subagentType?: string }).subagentType).toBe(
      "research"
    );
  });

  it("closes running subagent tasks on task_updated completion", () => {
    const parts: Array<Record<string, unknown>> = [];
    const adapter = createSdkToUiAdapter({
      write: (part) => parts.push(part as unknown as Record<string, unknown>),
    });

    adapter.consume({
      type: "system",
      subtype: "task_started",
      task_id: "task-2",
      subagent_type: "review",
      prompt: "review draft",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage);
    adapter.consume({
      type: "system",
      subtype: "task_updated",
      task_id: "task-2",
      patch: { status: "completed", description: "review done" },
      uuid: "u2",
      session_id: "s1",
    } as unknown as SDKMessage);

    const taskParts = parts.filter((p) => p.type === "data-agent-step");
    expect(taskParts).toHaveLength(2);
    expect((taskParts[1].data as { title?: string }).title).toBe(
      "子任务完成（review）"
    );
    expect((taskParts[1].data as { status?: string }).status).toBe("completed");
  });

  it("falls back to closing open subagent tasks when the turn result arrives", () => {
    const parts: Array<Record<string, unknown>> = [];
    const adapter = createSdkToUiAdapter({
      write: (part) => parts.push(part as unknown as Record<string, unknown>),
    });

    adapter.consume({
      type: "system",
      subtype: "task_started",
      task_id: "task-3",
      subagent_type: "research",
      prompt: "collect facts",
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage);
    adapter.consume({
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: "s1",
      result: "done",
      usage: {},
    } as unknown as SDKMessage);

    const taskParts = parts.filter((p) => p.type === "data-agent-step");
    expect(taskParts).toHaveLength(2);
    expect((taskParts[1].data as { title?: string }).title).toBe(
      "子任务完成（research）"
    );
    expect((taskParts[1].data as { detail?: string }).detail).toContain(
      "本轮对话已收口"
    );
  });

  it("hides SDK housekeeping tasks marked skip_transcript", () => {
    const parts: Array<Record<string, unknown>> = [];
    const adapter = createSdkToUiAdapter({
      write: (part) => parts.push(part as unknown as Record<string, unknown>),
    });

    adapter.consume({
      type: "system",
      subtype: "task_started",
      task_id: "ambient-1",
      description: "background bookkeeping",
      skip_transcript: true,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage);
    adapter.consume({
      type: "system",
      subtype: "task_progress",
      task_id: "ambient-1",
      description: "still working",
      usage: { total_tokens: 10, tool_uses: 0, duration_ms: 100 },
      uuid: "u2",
      session_id: "s1",
    } as unknown as SDKMessage);
    adapter.consume({
      type: "system",
      subtype: "task_notification",
      task_id: "ambient-1",
      status: "completed",
      output_file: "out.json",
      summary: "done",
      uuid: "u3",
      session_id: "s1",
    } as unknown as SDKMessage);
    adapter.flush();

    expect(parts.filter((p) => p.type === "data-agent-step")).toHaveLength(0);
  });
});
