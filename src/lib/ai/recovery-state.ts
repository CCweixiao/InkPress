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
