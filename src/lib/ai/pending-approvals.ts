/**
 * 进程内 blocking-Promise 桥（P3 权限闸门的核心机制）。
 *
 * SDK 的 canUseTool 是 async 且会被 await。命中 ASK 时，canUseTool 在此注册一个待审批项并
 * await 返回的 Promise；外部 HTTP 端点（POST /api/ai/agent-approvals）调用 resolveApproval
 * 唤醒它，SDK 解阻塞、**同一条 in-flight query 继续**（无需用户重发）。
 *
 * 单服务器开发期够用。局限：多实例 / 进程重启会丢失内存中的 resolver，此时 grant 行在 DB 里
 * 仍为 pending，靠 /status 的 TTL 兜底（超时视为 expired）解锁 composer；真正的跨进程 resume
 * 留 P5 SessionStore。
 */
type PendingApproval = {
  grantId: string;
  toolName: string;
  resolve: (decision: "allow" | "deny") => void;
  reject: (error: Error) => void;
};

const pending = new Map<string, PendingApproval>();

/** 注册一个待审批项，返回会在用户决定或中止时 settle 的 Promise。 */
export function registerPendingApproval(
  grantId: string,
  toolName: string
): Promise<"allow" | "deny"> {
  return new Promise<"allow" | "deny">((resolve, reject) => {
    pending.set(grantId, { grantId, toolName, resolve, reject });
  });
}

/** 用户做出决定：pop 并 resolve。返回是否命中（未命中 = 已过期 / 未知 grant）。 */
export function resolveApproval(
  grantId: string,
  decision: "allow" | "deny"
): boolean {
  const entry = pending.get(grantId);
  if (!entry) return false;
  pending.delete(grantId);
  entry.resolve(decision);
  return true;
}

/** 流中止/关闭：pop 并 reject，让 canUseTool 的 await 抛出（SDK 收到错误结束本轮）。 */
export function abortApproval(grantId: string): void {
  const entry = pending.get(grantId);
  if (!entry) return;
  pending.delete(grantId);
  entry.reject(new Error("approval aborted"));
}

/** 诊断/清理用。 */
export function pendingApprovalCount(): number {
  return pending.size;
}
