import type { ChatStatus, UIMessage } from "ai";

type RecoveryStatusInput = {
  clientStatus: ChatStatus;
  sessionStatus?: string | null;
  messages: UIMessage[];
};

/**
 * UI 恢复轮询只用于“上一轮服务端仍在跑，前端重挂载后等待输出落库”。
 * Claude Agent SDK 的上下文恢复由后端 options.resume 负责，不靠这个轮询触发。
 */
export function shouldPollRecoveringTurn({
  clientStatus,
  sessionStatus,
  messages,
}: RecoveryStatusInput): boolean {
  return (
    clientStatus === "ready" &&
    sessionStatus === "running" &&
    messages.at(-1)?.role === "user"
  );
}

export function selectFinishedMessages(
  current: UIMessage[],
  persisted: UIMessage[]
): UIMessage[] {
  return persisted.length > 0 ? persisted : current;
}

export function getRecoveredTurnNotice({
  clientStatus,
  sessionStatus,
  sessionError,
}: {
  clientStatus: ChatStatus;
  sessionStatus?: string | null;
  sessionError?: string | null;
}): { tone: "error" | "warning"; message: string } | null {
  if (clientStatus !== "ready") return null;
  if (sessionStatus === "error") {
    return {
      tone: "error",
      message: sessionError?.trim() || "上一轮生成失败，请稍后重试。",
    };
  }
  if (sessionStatus === "interrupted") {
    return {
      tone: "warning",
      message: "上一轮生成已中断，已保留发送内容与生成进度，可重新发送。",
    };
  }
  return null;
}
