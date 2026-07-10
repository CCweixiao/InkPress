import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  getRecoveredTurnNotice,
  selectFinishedMessages,
  shouldPollRecoveringTurn,
} from "../../src/lib/ai/recovery-state";

const userMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "继续" }],
} as UIMessage;

const assistantMessage = {
  id: "a1",
  role: "assistant",
  parts: [{ type: "text", text: "好了" }],
} as UIMessage;

describe("shouldPollRecoveringTurn", () => {
  it("仅在客户端空闲、服务端仍 running、末尾是 user 时轮询恢复输出", () => {
    expect(
      shouldPollRecoveringTurn({
        clientStatus: "ready",
        sessionStatus: "running",
        messages: [userMessage],
      })
    ).toBe(true);
  });

  it("服务端已经收口为 interrupted/error/ready 时不显示恢复轮询", () => {
    for (const sessionStatus of ["interrupted", "error", "ready", "cleared"]) {
      expect(
        shouldPollRecoveringTurn({
          clientStatus: "ready",
          sessionStatus,
          messages: [userMessage],
        })
      ).toBe(false);
    }
  });

  it("客户端仍在提交/流式输出时不启动 DB 轮询", () => {
    expect(
      shouldPollRecoveringTurn({
        clientStatus: "streaming",
        sessionStatus: "running",
        messages: [userMessage],
      })
    ).toBe(false);
  });

  it("末尾已经有 assistant 回复时不再恢复", () => {
    expect(
      shouldPollRecoveringTurn({
        clientStatus: "ready",
        sessionStatus: "running",
        messages: [userMessage, assistantMessage],
      })
    ).toBe(false);
  });

  it("完成后优先采用服务端持久化消息，避免流式 memo 遗漏最终工具结果", () => {
    expect(
      selectFinishedMessages([userMessage], [userMessage, assistantMessage])
    ).toEqual([userMessage, assistantMessage]);
    expect(selectFinishedMessages([userMessage], [])).toEqual([userMessage]);
  });

  it("返回页面后明确展示上一轮的中断或失败状态", () => {
    expect(
      getRecoveredTurnNotice({
        clientStatus: "ready",
        sessionStatus: "degraded",
        sessionError: "会话镜像不完整",
      })
    ).toEqual({
      tone: "warning",
      message: "会话镜像不完整，下一轮将开启新的 Agent 会话。",
    });
    expect(
      getRecoveredTurnNotice({
        clientStatus: "ready",
        sessionStatus: "error",
        sessionError: "模型服务暂时不可用",
      })
    ).toEqual({
      tone: "error",
      message: "模型服务暂时不可用",
    });
    expect(
      getRecoveredTurnNotice({
        clientStatus: "ready",
        sessionStatus: "interrupted",
        sessionError: null,
      })
    ).toEqual({
      tone: "warning",
      message: "上一轮生成已中断，已保留发送内容与生成进度，可重新发送。",
    });
    expect(
      getRecoveredTurnNotice({
        clientStatus: "streaming",
        sessionStatus: "error",
        sessionError: "旧错误",
      })
    ).toBeNull();
  });
});
